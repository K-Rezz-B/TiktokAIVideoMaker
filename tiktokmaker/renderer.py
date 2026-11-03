"""Rend les écrans (HTML de stage/) en images 1080x1920 avec un Chromium headless."""
import json

from playwright.sync_api import sync_playwright


class StageRenderer:
    def __init__(self, stage_url: str):
        self.stage_url = stage_url
        self._pw = None
        self._browser = None
        self.page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch()
        # 360x640 CSS * 3 = 1080x1920 pixels
        self.page = self._browser.new_page(viewport={"width": 360, "height": 640}, device_scale_factor=3)
        try:
            self.page.goto(self.stage_url, wait_until="networkidle", timeout=20000)
        except Exception:
            # Polices Google indisponibles (hors ligne) : on continue avec les polices système
            self.page.goto(self.stage_url, wait_until="load", timeout=20000)
        self.page.evaluate("() => document.fonts.ready.then(() => true)")
        return self

    def __exit__(self, *exc):
        try:
            self._browser.close()
        finally:
            self._pw.stop()

    def render(self, state: dict) -> bytes:
        self.page.evaluate("s => window.renderState(s)", state)
        return self.page.screenshot(type="jpeg", quality=93)


def state_key(state: dict) -> str:
    return json.dumps(state, sort_keys=True, ensure_ascii=False)
