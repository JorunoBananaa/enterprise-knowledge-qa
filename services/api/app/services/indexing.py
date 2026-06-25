import logging

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.document import DocumentIndexStatus
from app.models.document_chunk import DocumentChunk
from app.repositories.documents import get_document_by_id, update_document
from app.repositories.llm_config import get_active_llm_config
from app.services.embedding_factory import create_embeddings
from app.services.ingestion import parse_document

logger = logging.getLogger(__name__)


def _get_embedding_model():
    """解析 embedding 模型。

    对远程提供商（openai、zhipu 等）：复用活跃 LLM 配置的
    API key / base URL，但使用 settings 中的 embedding_model_name。

    对本地提供商（huggingface）：无需 LLM 配置 —— 完全离线运行，
    模型从 HuggingFace Hub 自动下载。
    """
    provider = settings.embedding_provider

    if provider == "huggingface":
        return create_embeddings(
            provider="huggingface",
            model_name=settings.embedding_model_name,
        )

    # 远程提供商需要活跃的 LLM 配置来获取 API key
    active_cfg = get_active_llm_config()
    if active_cfg is None:
        raise RuntimeError("未找到活跃的 LLM 配置 —— 无法生成 embeddings")

    return create_embeddings(
        provider=active_cfg.provider,
        model_name=settings.embedding_model_name,
        api_key=active_cfg.api_key,
        base_url=active_cfg.base_url,
    )


def index_document(document_id: int) -> None:
    """解析已通过的文档，生成 embeddings，将块存入 pgvector。

    步骤：
    1. 标记文档为 INDEXING
    2. 将文件解析为文本块
    3. 为每个块生成向量 embeddings
    4. 将块 + embeddings 存入 document_chunks 表
    5. 标记文档为 INDEXED（失败则标记为 FAILED）
    """
    document = get_document_by_id(document_id)
    if document is None:
        return

    db = SessionLocal()
    try:
        # 1. 标记为索引中
        update_document(document_id, index_status=DocumentIndexStatus.INDEXING.value)

        # 2. 将文档解析为文本块
        chunks = parse_document(document.storage_path, document.file_type)
        if not chunks:
            update_document(
                document_id,
                index_status=DocumentIndexStatus.FAILED.value,
                failure_reason="无可解析内容",
            )
            return

        # 3. 生成 embeddings
        embed_model = _get_embedding_model()
        texts = [chunk.text for chunk in chunks]
        embeddings = embed_model.embed_documents(texts)

        # 4. 删除该文档的旧块（重新索引场景）
        db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document_id
        ).delete()

        # 5. 存储块及其 embeddings
        for chunk, embedding in zip(chunks, embeddings):
            db.add(DocumentChunk(
                document_id=document_id,
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                locator=chunk.locator,
                embedding=embedding,
            ))

        db.commit()

        # 6. 标记为已索引
        update_document(document_id, index_status=DocumentIndexStatus.INDEXED.value)

    except Exception as e:
        db.rollback()
        logger.exception("Indexing failed for document %s", document_id)
        update_document(
            document_id,
            index_status=DocumentIndexStatus.FAILED.value,
            failure_reason=str(e),
        )
    finally:
        db.close()
