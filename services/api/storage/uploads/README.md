# uploads 目录说明

这个目录用于保存后端接收到的原始上传文件。

当用户通过文档上传接口提交 PDF、Word、PowerPoint、Excel 等文件时，后端会在 `app/services/storage.py` 的 `save_upload()` 中把文件写入这里，并使用随机 UUID 生成文件名，避免原始文件名冲突。

上传后的文件路径会记录到数据库的文档记录里，后续文档解析、索引和问答引用会根据这个路径读取原始文件。

目录结构通常是：

```text
services/api/storage/
  knowledge_qa.db      # 本地 SQLite 数据库文件
  uploads/             # 上传的原始文档文件
```

注意：`storage/` 属于本地运行数据，已经被 `.gitignore` 忽略。这里的上传文件和本地数据库一般不应提交到 Git。
