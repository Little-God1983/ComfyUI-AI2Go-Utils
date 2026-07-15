# Tests for the comfy-free resolution core — part of ComfyUI-AI2Go-Utils. GPL-3.0.
from nodes.resolution_core import (
    resolve_dims, effective_ar, parse_ar, profile_clamps, aspect_options,
)

SQ = "1:1 (Square)"
WS = "16:9 (Widescreen)"


def test_default_profile_never_clamps():
    assert resolve_dims("default", "raw", SQ, "landscape", 8, 1.0, 5000, 5000) == (5000, 5000)


def test_snap_multiple_rounds_to_8():
    # 1021/8 = 127.625 -> 128 -> 1024 ; 1000 already a multiple of 8
    assert resolve_dims("default", "raw", SQ, "landscape", 8, 1.0, 1021, 1000) == (1024, 1000)


def test_snap_multiple_is_configurable():
    # 1030/64 = 16.09 -> 16 -> 1024
    assert resolve_dims("default", "raw", SQ, "landscape", 64, 1.0, 1030, 1030) == (1024, 1024)


def test_ideogram_ignores_snap_multiple():
    # snap_multiple=64 is ignored; Ideogram stays mult 16: 1050/16 = 65.625 -> 66 -> 1056
    assert resolve_dims("Ideogram 4", "raw", SQ, "landscape", 64, 1.0, 1050, 1050) == (1056, 1056)


def test_default_uses_snap_multiple_not_model_mult():
    # same input as above but default profile + mult 64 -> 1024, proving the two profiles differ
    assert resolve_dims("default", "raw", SQ, "landscape", 64, 1.0, 1050, 1050) == (1024, 1024)


def test_ideogram_clamps_16_9_keeping_aspect():
    assert resolve_dims("Ideogram 4", "auto", WS, "landscape", 8, 1.0, 4000, 0) == (2048, 1152)


def test_orientation_transpose_portrait_is_taller():
    w, h = resolve_dims("default", "auto", WS, "portrait", 8, 1.0, 1080, 0)
    assert h > w and (w, h) == (1080, 1920)


def test_orientation_landscape_is_wider():
    w, h = resolve_dims("default", "auto", WS, "landscape", 8, 1.0, 1920, 0)
    assert w > h and (w, h) == (1920, 1080)


def test_effective_ar_inverts_for_portrait():
    assert round(effective_ar(WS, "landscape"), 4) == round(16 / 9, 4)
    assert round(effective_ar(WS, "portrait"), 4) == round(9 / 16, 4)


def test_backward_compat_bare_ratio_matches_label():
    bare = resolve_dims("default", "auto", "16:9", "landscape", 8, 1.0, 1920, 0)
    label = resolve_dims("default", "auto", WS, "landscape", 8, 1.0, 1920, 0)
    assert bare == label == (1920, 1080)
    assert parse_ar("16:9") == parse_ar(WS)


def test_new_21_9_ratio():
    # 21:9 ; 2016 is a multiple of 8 and 2016*9/21 = 864 (also /8) -> no rounding ambiguity
    assert resolve_dims("default", "auto", "21:9 (Cinemascope)", "landscape", 8, 1.0, 2016, 0) == (2016, 864)


def test_profile_clamps_flag():
    assert profile_clamps("Ideogram 4") is True
    assert profile_clamps("default") is False


def test_aspect_options_shape():
    opts = aspect_options()
    assert opts[0] == "1:1 (Square)"
    assert "16:9 (Widescreen)" in opts
    assert "21:9 (Cinemascope)" in opts
    assert len(opts) == 9
    # square + landscape only — no portrait ratios listed
    assert not any(lbl.startswith(("9:16", "2:3", "3:4", "4:5", "1:2", "9:21", "1:3")) for lbl in opts)
