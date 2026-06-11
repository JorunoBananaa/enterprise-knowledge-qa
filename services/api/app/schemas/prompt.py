from pydantic import BaseModel


class SystemPromptUpdate(BaseModel):
    content: str = ""


class SystemPromptResponse(BaseModel):
    content: str


class UserPromptUpdate(BaseModel):
    content: str = ""


class UserPromptResponse(BaseModel):
    content: str
