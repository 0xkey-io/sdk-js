import asyncio
import json
import ssl
import sys
from urllib.parse import urlparse

import httpx
from eth_account import Account
from x402 import x402Client
from x402.http import x402HTTPClient
from x402.http.clients import x402AsyncTransport
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client

async def main():
    if len(sys.argv) != 3:
        raise RuntimeError("usage: client.py URL CA")
    url, ca = sys.argv[1:]
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "127.0.0.1":
        raise RuntimeError("non-loopback URL")
    context = ssl.create_default_context(cafile=ca)
    account = Account.from_key("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    payment = x402Client()
    register_exact_evm_client(payment, EthAccountSigner(account))
    helper = x402HTTPClient(payment)
    base = httpx.AsyncHTTPTransport(verify=context)
    transport = x402AsyncTransport(helper, base)
    async with httpx.AsyncClient(transport=transport, timeout=15.0, trust_env=False, follow_redirects=False) as client:
        response = await client.get(url)
        await response.aread()
    if response.status_code != 200 or not response.headers.get("PAYMENT-RESPONSE") or response.json() != {"ok": True}:
        raise RuntimeError("payment response invalid")
    print(json.dumps({"status":"PASSED", "runtime":"python-x402-2.20.0", "httpStatus":200, "paymentResponse":True}))

asyncio.run(main())
