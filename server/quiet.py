"""លាក់ traceback គ្មានគ្រោះថ្នាក់មួយរបស់ asyncio លើ Windows — **តែមួយនោះប៉ុណ្ណោះ**.

ពេលអ្នកចេញពី screen ដែលមាន `<video>` (ឧ. ចុច Home ពី Review) WebView2 បិទ connection វីដេអូ
ភ្លាមៗ (RST). ក្រោយមក ProactorEventLoop ព្យាយាម `sock.shutdown()` លើ socket ដែលបិទរួច ហើយ
បោះពុម្ព "Exception in callback _ProactorBasePipeTransport._call_connection_lost()" ជាមួយ
`ConnectionResetError: [WinError 10054]`. Connection នោះត្រូវបានបិទដោយចេតនា ហើយ server
នៅដំណើរការធម្មតា — វាគ្រាន់តែជា noise ក្នុង terminal (រាយការណ៍ដោយអ្នកអភិវឌ្ឍ, បង្កើតឡើងវិញ
ក្នុង app ពិតដោយចុច Home ពី Review/Subtitles).

Error ផ្សេងៗទាំងអស់ — រួមទាំង reset ដែលមិនមែនមកពី `_call_connection_lost` — នៅតែទៅ handler
លំនាំដើមរបស់ asyncio ដូចមុន.
"""

import asyncio

CLIENT_GONE = (ConnectionResetError, ConnectionAbortedError)


def is_client_reset(context: dict) -> bool:
    """តើ context នេះជា reset ពេលបិទ connection (ដែលគ្មានគ្រោះថ្នាក់) ឬទេ?"""
    error = context.get("exception")
    handle = context.get("handle")
    return isinstance(error, CLIENT_GONE) and "_call_connection_lost" in repr(handle)


def install(loop: asyncio.AbstractEventLoop) -> None:
    """ដាក់ handler លើ loop: លាក់តែ reset ពេលបិទ connection, ផ្សេងទៀតបញ្ជូនបន្ត."""
    def handler(loop: asyncio.AbstractEventLoop, context: dict) -> None:
        if is_client_reset(context):
            return
        loop.default_exception_handler(context)

    loop.set_exception_handler(handler)
