#!/usr/bin/env python3
"""Gate test: CONFIDENT_API_KEY presence alone must never equal upload consent."""

from platform_bakeoff import gate_confident_upload


def main():
    env = {"CONFIDENT_API_KEY": "not-a-real-key"}
    assert "CONFIDENT_API_KEY" not in gate_confident_upload(env), (
        "key must be scrubbed without explicit opt-in"
    )

    env = {"CONFIDENT_API_KEY": "not-a-real-key", "GSTACK_CONFIDENT_UPLOAD": "1"}
    assert "CONFIDENT_API_KEY" in gate_confident_upload(env), (
        "explicit opt-in must keep the key"
    )

    assert "CONFIDENT_API_KEY" not in gate_confident_upload({"GSTACK_CONFIDENT_UPLOAD": "0"})
    assert "CONFIDENT_API_KEY" not in gate_confident_upload({})
    print("ok")


if __name__ == "__main__":
    main()
