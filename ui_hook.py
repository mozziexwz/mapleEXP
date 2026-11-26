"""Runtime pure-UI localization hooks for unmodified Maple Classic Exp Overlay.

Intercepts only the presentation boundary (Tkinter widgets, Canvas text items,
Menus, Treeview headings/rows, Dialogs, tkfont.Font.measure, and ui_gfx.Gfx
Pillow font rendering). Never touches OCR, game capture, log/config files, or
internal Python dict keys.
"""
import json
import os
import re
import weakref

_CJK_RE = re.compile(r"[\u2e80-\u9fff]")


class Translator:
    """Fast cached dictionary + regex UI translator with live EN/ZH toggle."""

    def __init__(self, data, enabled=True, log_fn=None):
        self.enabled = bool(enabled)
        self.log = log_fn or (lambda _msg: None)
        self.exact = dict(data.get("exact") or {})
        # Support .upper() section headers and metric tile captions (e.g. "ELAPSED", "NET / HR", "TRACKING")
        self._exact_upper = {k.upper(): v for k, v in self.exact.items() if len(k) >= 3}
        self.patterns = [
            (re.compile(pat, re.S), repl)
            for pat, repl in (data.get("patterns") or [])
        ]
        self.post_replace = list(data.get("post_replace") or [])
        self.post_patterns = [
            (re.compile(pat), repl)
            for pat, repl in (data.get("post_patterns") or [])
        ]
        self._cache = {}
        self._refresh_callbacks = []

    def _apply_post(self, text):
        out = text
        for old, new in self.post_replace:
            if old in out:
                out = out.replace(old, new)
        for rx, repl in self.post_patterns:
            if rx.search(out):
                out = rx.sub(repl, out)
        return out

    def _translate_single(self, text):
        hit = self.exact.get(text)
        if hit is not None:
            return hit
        if text.isupper():
            uhit = self._exact_upper.get(text)
            if uhit is not None:
                return uhit
        for rx, repl in self.patterns:
            m = rx.match(text)
            if m:
                try:
                    return self._apply_post(m.expand(repl))
                except Exception:
                    return rx.sub(repl, text)
        # Check for composed sentences with known trailing suffixes
        for sep in (
            " Estimated from the % (the bar shows no number;",
            " This is report #",
            "  (just logged)",
        ):
            idx = text.find(sep)
            if idx > 0:
                head = self._translate_single(text[:idx])
                tail = self._apply_post(text[idx:])
                if head != text[:idx] or tail != text[idx:]:
                    return head + tail
        post = self._apply_post(text)
        if post != text:
            return post
        return text

    def translate(self, text):
        if not self.enabled or not isinstance(text, str) or not text:
            return text
        cached = self._cache.get(text)
        if cached is not None:
            return cached
        res = self._translate_single(text)
        if res == text and "\n" in text:
            lines = text.split("\n")
            new_lines = [self._translate_single(line) if line else line for line in lines]
            joined = "\n".join(new_lines)
            if joined != text:
                res = self._apply_post(joined)
        if len(self._cache) > 4096:
            self._cache.clear()
        self._cache[text] = res
        return res

    def register_refresh(self, fn):
        self._refresh_callbacks.append(fn)

    def toggle(self):
        self.enabled = not self.enabled
        self._cache.clear()
        for fn in list(self._refresh_callbacks):
            try:
                fn()
            except Exception as exc:
                self.log(f"[hans] refresh error: {exc}")
        return self.enabled


_TRANSLATOR = None
_IN_REFRESH = False


def get_translator():
    return _TRANSLATOR


def install(dict_data, lang="zh", log_fn=None):
    global _TRANSLATOR
    if isinstance(dict_data, str):
        dict_data = json.loads(dict_data)
    tr = Translator(dict_data, enabled=(lang != "en"), log_fn=log_fn)
    _TRANSLATOR = tr
    _install_tk_hooks(tr)
    return tr


def _install_tk_hooks(tr):
    import tkinter as tk
    from tkinter import font as tkfont, messagebox, simpledialog, ttk

    widget_orig = weakref.WeakKeyDictionary()
    canvas_orig = weakref.WeakKeyDictionary()
    var_orig = {}  # id(var) -> (weakref.ref(var), orig_str); StringVar is unhashable in Tk
    title_orig = weakref.WeakKeyDictionary()
    tree_head_orig = weakref.WeakKeyDictionary()
    tree_item_orig = weakref.WeakKeyDictionary()
    ui_buttons = weakref.WeakSet()
    ui_pills = weakref.WeakSet()

    def _remember_var(v, orig_val):
        vid = id(v)
        var_orig[vid] = (weakref.ref(v, lambda _r, k=vid: var_orig.pop(k, None)), orig_val)

    _SKIP_WIDGETS = {"entry", "spinbox", "text", "ttk::entry", "ttk::spinbox", "ttk::combobox"}

    def _tr_opt_dict(d, store, skip_text=False):
        if not isinstance(d, dict):
            return
        for key in ("text", "label"):
            if key == "text" and skip_text:
                continue
            val = d.get(key)
            if isinstance(val, str):
                store[key] = val
                d[key] = tr.translate(val)

    # 1. BaseWidget.__init__
    orig_base_init = tk.BaseWidget.__init__

    def hooked_base_init(self, master, widgetName, cnf={}, kw={}, extra=()):
        if not _IN_REFRESH:
            skip = str(widgetName).lower() in _SKIP_WIDGETS
            store = {}
            if isinstance(cnf, dict) and cnf:
                cnf = dict(cnf)
                _tr_opt_dict(cnf, store, skip_text=skip)
            if kw:
                kw = dict(kw)
                _tr_opt_dict(kw, store, skip_text=skip)
            orig_base_init(self, master, widgetName, cnf, kw, extra)
            if store:
                widget_orig[self] = store
        else:
            orig_base_init(self, master, widgetName, cnf, kw, extra)

    tk.BaseWidget.__init__ = hooked_base_init

    # 2. Misc._configure
    orig_configure = tk.Misc._configure

    def hooked_configure(self, cmd, cnf, kw):
        is_widget_cfg = (cmd == "configure" or cmd == ("configure",))
        if not _IN_REFRESH and is_widget_cfg and (isinstance(cnf, dict) or kw):
            wname = getattr(self, "widgetName", "")
            skip = str(wname).lower() in _SKIP_WIDGETS
            store = widget_orig.get(self)
            new_store = {}
            if isinstance(cnf, dict) and cnf:
                cnf = dict(cnf)
                _tr_opt_dict(cnf, new_store, skip_text=skip)
            if kw:
                kw = dict(kw)
                _tr_opt_dict(kw, new_store, skip_text=skip)
            if new_store:
                if store is None:
                    widget_orig[self] = new_store
                else:
                    store.update(new_store)
        return orig_configure(self, cmd, cnf, kw)

    tk.Misc._configure = hooked_configure

    # 3. Canvas.create_text & itemconfigure
    orig_create_text = tk.Canvas.create_text

    def hooked_create_text(self, *args, **kw):
        orig_txt = None
        if not _IN_REFRESH:
            if "text" in kw and isinstance(kw["text"], str):
                orig_txt = kw["text"]
                kw = dict(kw)
                kw["text"] = tr.translate(orig_txt)
        item_id = orig_create_text(self, *args, **kw)
        if orig_txt is not None:
            canvas_orig.setdefault(self, {})[item_id] = orig_txt
        return item_id

    tk.Canvas.create_text = hooked_create_text

    orig_itemconfigure = tk.Canvas.itemconfigure

    def hooked_itemconfigure(self, tagOrId, cnf=None, **kw):
        if not _IN_REFRESH:
            orig_txt = None
            if isinstance(cnf, dict) and isinstance(cnf.get("text"), str):
                orig_txt = cnf["text"]
                cnf = dict(cnf)
                cnf["text"] = tr.translate(orig_txt)
            if isinstance(kw.get("text"), str):
                orig_txt = kw["text"]
                kw = dict(kw)
                kw["text"] = tr.translate(orig_txt)
            if orig_txt is not None and isinstance(tagOrId, int):
                canvas_orig.setdefault(self, {})[tagOrId] = orig_txt
        return orig_itemconfigure(self, tagOrId, cnf, **kw)

    tk.Canvas.itemconfigure = hooked_itemconfigure
    tk.Canvas.itemconfig = hooked_itemconfigure

    # 4. Wm.wm_title / title
    orig_wm_title = tk.Wm.wm_title

    def hooked_wm_title(self, string=None):
        if string is not None and isinstance(string, str) and not _IN_REFRESH:
            title_orig[self] = string
            string = tr.translate(string)
        return orig_wm_title(self, string)

    tk.Wm.wm_title = hooked_wm_title
    tk.Wm.title = hooked_wm_title

    # 5. Menu.add & entryconfigure
    orig_menu_add = tk.Menu.add

    def hooked_menu_add(self, itemType, cnf={}, **kw):
        if not _IN_REFRESH:
            if isinstance(cnf, dict) and isinstance(cnf.get("label"), str):
                cnf = dict(cnf)
                cnf["label"] = tr.translate(cnf["label"])
            if isinstance(kw.get("label"), str):
                kw = dict(kw)
                kw["label"] = tr.translate(kw["label"])
        return orig_menu_add(self, itemType, cnf, **kw)

    tk.Menu.add = hooked_menu_add

    orig_entryconfigure = tk.Menu.entryconfigure

    def hooked_entryconfigure(self, index, cnf=None, **kw):
        if not _IN_REFRESH:
            if isinstance(cnf, dict) and isinstance(cnf.get("label"), str):
                cnf = dict(cnf)
                cnf["label"] = tr.translate(cnf["label"])
            if isinstance(kw.get("label"), str):
                kw = dict(kw)
                kw["label"] = tr.translate(kw["label"])
        return orig_entryconfigure(self, index, cnf, **kw)

    tk.Menu.entryconfigure = hooked_entryconfigure
    tk.Menu.entryconfig = hooked_entryconfigure

    # 6. ttk.Treeview.heading, insert, item
    orig_tv_heading = ttk.Treeview.heading

    def hooked_tv_heading(self, column, option=None, **kw):
        if not _IN_REFRESH and isinstance(kw.get("text"), str):
            orig_txt = kw["text"]
            tree_head_orig.setdefault(self, {})[column] = orig_txt
            kw = dict(kw)
            kw["text"] = tr.translate(orig_txt)
        return orig_tv_heading(self, column, option, **kw)

    ttk.Treeview.heading = hooked_tv_heading

    def _tr_values(vals):
        if isinstance(vals, (list, tuple)):
            return tuple(tr.translate(v) if isinstance(v, str) else v for v in vals)
        return vals

    orig_tv_insert = ttk.Treeview.insert

    def hooked_tv_insert(self, parent, index, iid=None, **kw):
        rec_text = None
        rec_vals = None
        if not _IN_REFRESH:
            if isinstance(kw.get("text"), str):
                rec_text = kw["text"]
                kw = dict(kw)
                kw["text"] = tr.translate(rec_text)
            if "values" in kw and isinstance(kw["values"], (list, tuple)):
                rec_vals = tuple(kw["values"])
                kw = dict(kw)
                kw["values"] = _tr_values(rec_vals)
        res_iid = orig_tv_insert(self, parent, index, iid=iid, **kw)
        if rec_text is not None or rec_vals is not None:
            tree_item_orig.setdefault(self, {})[res_iid] = (rec_text, rec_vals)
        return res_iid

    ttk.Treeview.insert = hooked_tv_insert

    orig_tv_item = ttk.Treeview.item

    def hooked_tv_item(self, item, option=None, **kw):
        if not _IN_REFRESH and kw:
            prev = tree_item_orig.setdefault(self, {}).get(item, (None, None))
            rec_text, rec_vals = prev
            changed = False
            if isinstance(kw.get("text"), str):
                rec_text = kw["text"]
                kw = dict(kw)
                kw["text"] = tr.translate(rec_text)
                changed = True
            if "values" in kw and isinstance(kw["values"], (list, tuple)):
                rec_vals = tuple(kw["values"])
                kw = dict(kw)
                kw["values"] = _tr_values(rec_vals)
                changed = True
            if changed:
                tree_item_orig[self][item] = (rec_text, rec_vals)
        return orig_tv_item(self, item, option, **kw)

    ttk.Treeview.item = hooked_tv_item

    # 7. StringVar (display status / hints; pure numeric entry vars pass through unchanged)
    orig_sv_init = tk.StringVar.__init__

    def hooked_sv_init(self, master=None, value=None, name=None):
        orig_val = value
        if not _IN_REFRESH and isinstance(value, str):
            value = tr.translate(value)
        orig_sv_init(self, master, value, name)
        if isinstance(orig_val, str):
            _remember_var(self, orig_val)

    tk.StringVar.__init__ = hooked_sv_init

    orig_sv_set = tk.StringVar.set

    def hooked_sv_set(self, value):
        if not _IN_REFRESH and isinstance(value, str):
            _remember_var(self, value)
            value = tr.translate(value)
        return orig_sv_set(self, value)

    tk.StringVar.set = hooked_sv_set

    # 8. Messagebox & simpledialog
    orig_mb_show = messagebox._show

    def hooked_mb_show(title=None, message=None, _icon=None, _type=None, **options):
        if isinstance(title, str):
            title = tr.translate(title)
        if isinstance(message, str):
            message = tr.translate(message)
        return orig_mb_show(title, message, _icon, _type, **options)

    messagebox._show = hooked_mb_show

    orig_qd_init = simpledialog._QueryDialog.__init__

    def hooked_qd_init(self, title, prompt, initialvalue=None, minvalue=None, maxvalue=None, parent=None):
        if isinstance(title, str):
            title = tr.translate(title)
        if isinstance(prompt, str):
            prompt = tr.translate(prompt)
        return orig_qd_init(self, title, prompt, initialvalue, minvalue, maxvalue, parent)

    simpledialog._QueryDialog.__init__ = hooked_qd_init

    # 9. tkfont.Font.measure (ensures Buttons, Pills, Strip measure translated width accurately)
    orig_measure = tkfont.Font.measure

    def hooked_measure(self, text, displayof=None):
        if isinstance(text, str):
            text = tr.translate(text)
        return orig_measure(self, text, displayof)

    tkfont.Font.measure = hooked_measure

    # Live refresh callback for EN <-> ZH toggle
    def refresh_all():
        global _IN_REFRESH
        _IN_REFRESH = True
        try:
            for w, opts in list(widget_orig.items()):
                try:
                    if not w.winfo_exists():
                        continue
                    upd = {k: tr.translate(v) for k, v in opts.items()}
                    w.configure(**upd)
                except Exception:
                    pass
            for c, items in list(canvas_orig.items()):
                try:
                    if not c.winfo_exists():
                        continue
                    for iid, orig_txt in list(items.items()):
                        try:
                            c.itemconfigure(iid, text=tr.translate(orig_txt))
                        except Exception:
                            pass
                except Exception:
                    pass
            for _vid, (vref, orig_val) in list(var_orig.items()):
                try:
                    v = vref()
                    if v is not None:
                        v.set(tr.translate(orig_val))
                except Exception:
                    pass
            for wm, orig_t in list(title_orig.items()):
                try:
                    if wm.winfo_exists():
                        wm.wm_title(tr.translate(orig_t))
                except Exception:
                    pass
            for tv, cols in list(tree_head_orig.items()):
                try:
                    if not tv.winfo_exists():
                        continue
                    for col, orig_t in list(cols.items()):
                        try:
                            tv.heading(col, text=tr.translate(orig_t))
                        except Exception:
                            pass
                except Exception:
                    pass
            for tv, rows in list(tree_item_orig.items()):
                try:
                    if not tv.winfo_exists():
                        continue
                    for iid, (ot, ov) in list(rows.items()):
                        try:
                            if not tv.exists(iid):
                                continue
                            kw = {}
                            if ot is not None:
                                kw["text"] = tr.translate(ot)
                            if ov is not None:
                                kw["values"] = _tr_values(ov)
                            if kw:
                                tv.item(iid, **kw)
                        except Exception:
                            pass
                except Exception:
                    pass
            # Re-render custom ui_main Buttons and Pills so centering & widths recalculate
            for btn in list(ui_buttons):
                try:
                    if btn.winfo_exists():
                        btn._render()
                except Exception:
                    pass
            for pill in list(ui_pills):
                try:
                    if pill.winfo_exists() and getattr(pill, "_last", None):
                        st, txt = pill._last
                        pill._last = None
                        pill.set(st, txt)
                except Exception:
                    pass
        finally:
            _IN_REFRESH = False

    tr.register_refresh(refresh_all)
    tr._ui_buttons = ui_buttons
    tr._ui_pills = ui_pills


def patch_module(module):
    """Patch ui_gfx (CJK font fallback) and ui_main (Button/Pill tracking + toggle item)."""
    tr = _TRANSLATOR
    if tr is None:
        return
    name = getattr(module, "__name__", "")

    if name == "ui_gfx":
        Gfx = getattr(module, "Gfx", None)
        if Gfx is None or getattr(Gfx, "_hans_patched", False):
            return
        from PIL import ImageFont
        import math

        CJK_FONTS = (
            "msyh.ttc",
            "msyhbd.ttc",
            "simhei.ttf",
            "SimSun.ttc",
            "NotoSansCJK-Regular.ttc",
        )
        SS = getattr(module, "SS", 3)
        gfx_instances = weakref.WeakSet()

        orig_init = Gfx.__init__

        def hooked_init(self, *args, **kw):
            orig_init(self, *args, **kw)
            gfx_instances.add(self)

        def font_for(self, text, weight, size):
            if not _CJK_RE.search(str(text)):
                return self.font(weight, size)
            key = ("_hans_cjk", weight, size)
            if key not in self._fonts:
                px = max(6, round(size * self.s * SS))
                names = (CJK_FONTS[1:2] + CJK_FONTS) if weight in ("bold", "extra") else CJK_FONTS
                for fname in names:
                    try:
                        self._fonts[key] = ImageFont.truetype(fname, px)
                        break
                    except Exception:
                        continue
                else:
                    return self.font(weight, size)
            return self._fonts[key]

        def hooked_text_width(self, text, weight, size):
            t = tr.translate(text) if isinstance(text, str) else text
            return int(math.ceil(self.font_for(t, weight, size).getlength(t) / SS))

        orig_text = Gfx.text

        def hooked_text(self, text, weight, size, top, bottom=None, glow=None):
            t = tr.translate(text) if isinstance(text, str) else text
            if not _CJK_RE.search(str(t)):
                return orig_text(self, t, weight, size, top, bottom, glow)
            # Temporarily direct self.font() to our CJK font while orig_text renders
            orig_font = self.font
            self.font = lambda w, sz: self.font_for(t, w, sz)
            try:
                return orig_text(self, t, weight, size, top, bottom, glow)
            finally:
                self.font = orig_font

        Gfx.__init__ = hooked_init
        Gfx.font_for = font_for
        Gfx.text_width = hooked_text_width
        Gfx.text = hooked_text
        Gfx._hans_patched = True

        def clear_gfx():
            for g in list(gfx_instances):
                try:
                    g._cache.clear()
                except Exception:
                    pass

        tr.register_refresh(clear_gfx)

    elif name == "ui_main":
        Button = getattr(module, "Button", None)
        Pill = getattr(module, "Pill", None)
        PopupMenu = getattr(module, "PopupMenu", None)

        if Button is not None and not getattr(Button, "_hans_patched", False):
            orig_btn_init = Button.__init__

            def hooked_btn_init(self, *args, **kw):
                orig_btn_init(self, *args, **kw)
                tr._ui_buttons.add(self)

            Button.__init__ = hooked_btn_init
            Button._hans_patched = True

        if Pill is not None and not getattr(Pill, "_hans_patched", False):
            orig_pill_init = Pill.__init__

            def hooked_pill_init(self, *args, **kw):
                orig_pill_init(self, *args, **kw)
                tr._ui_pills.add(self)

            Pill.__init__ = hooked_pill_init
            Pill._hans_patched = True

        if PopupMenu is not None and not getattr(PopupMenu, "_hans_patched", False):
            orig_popup_init = PopupMenu.__init__

            def hooked_popup_init(self, theme, anchor, items):
                toggle_label = "切换为 English" if tr.enabled else "切换为 简体中文"
                extra = list(items) + [(toggle_label, None, tr.toggle)]
                return orig_popup_init(self, theme, anchor, extra)

            PopupMenu.__init__ = hooked_popup_init
            PopupMenu._hans_patched = True
