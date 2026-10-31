from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import invoices, subscriptions

app = FastAPI(title="Brightloop Subscription API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(subscriptions.router)
app.include_router(invoices.router)


@app.get("/health")
def health():
    return {"status": "ok"}