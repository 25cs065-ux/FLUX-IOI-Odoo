from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(
    title="FLUX-IOI-Odoo Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Explicit frontend origins (no wildcard when allow_credentials=True)
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
if not origins:
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "healthy"}

# Existing Aadya routers
try:
    from app.routers.subscriptions import router as subscriptions_router
    app.include_router(subscriptions_router)
except ImportError:
    pass

try:
    from app.routers.invoices import router as invoices_router
    app.include_router(invoices_router)
except ImportError:
    pass

try:
    from app.routers.payments import router as payments_router
    app.include_router(payments_router)
except ImportError:
    pass

# Feature routers
try:
    from app.routers.plans import router as plans_router
    app.include_router(plans_router)
except ImportError:
    pass

try:
    from app.routers.variants import router as variants_router
    app.include_router(variants_router)
except ImportError:
    pass

try:
    from app.routers.taxes import router as taxes_router
    app.include_router(taxes_router)
except ImportError:
    pass

try:
    from app.routers.discounts import router as discounts_router
    app.include_router(discounts_router)
except ImportError:
    pass

try:
    from app.routers.customers import router as customers_router
    app.include_router(customers_router)
except ImportError:
    pass

try:
    from app.routers.quotation_templates import router as quotation_templates_router
    app.include_router(quotation_templates_router)
except ImportError:
    pass

try:
    from app.routers.change_requests import router as change_requests_router
    app.include_router(change_requests_router)
except ImportError:
    pass
