from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    status: str


class LoginResponse(BaseModel):
    user: CurrentUser


class MessageResponse(BaseModel):
    detail: str
