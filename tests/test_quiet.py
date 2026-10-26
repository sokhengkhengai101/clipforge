"""server/quiet.py: លាក់តែ reset ពេលបិទ connection វីដេអូ (Windows), មិនលាក់ error ផ្សេងទេ."""

import asyncio

from server import quiet


class Handle:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return f"<Handle {self.name}()>"


def run_with_handler(context):
    """ដាក់ handler លើ loop ថ្មី ហើយរាប់ថាវាបញ្ជូនទៅ handler លំនាំដើមប៉ុន្មានដង."""
    loop = asyncio.new_event_loop()
    passed = []
    loop.default_exception_handler = lambda ctx: passed.append(ctx)
    try:
        quiet.install(loop)
        loop.call_exception_handler(context)
    finally:
        loop.close()
    return passed


def test_reset_while_closing_a_video_connection_is_silent():
    context = {"message": "Exception in callback",
               "exception": ConnectionResetError(10054, "forcibly closed"),
               "handle": Handle("_ProactorBasePipeTransport._call_connection_lost")}
    assert run_with_handler(context) == []
    context["exception"] = ConnectionAbortedError()
    assert run_with_handler(context) == []


def test_every_other_error_still_reaches_the_default_handler():
    other_callback = {"message": "x", "exception": ConnectionResetError(),
                      "handle": Handle("Something._read_ready")}
    other_error = {"message": "x", "exception": ValueError("real bug"),
                   "handle": Handle("_ProactorBasePipeTransport._call_connection_lost")}
    no_exception = {"message": "Task was destroyed but it is pending!"}
    for context in (other_callback, other_error, no_exception):
        assert len(run_with_handler(context)) == 1
