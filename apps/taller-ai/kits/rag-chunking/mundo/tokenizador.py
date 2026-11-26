"""Baja el tokenizer del modelo de embeddings del dojo (intfloat/multilingual-e5-small) a modelo/tokenizer.json.

    python mundo/tokenizador.py            # una vez, con internet (17 MB); después todo corre sin red

Lo baja de un commit fijo de Hugging Face (no de «main», que puede cambiar mañana) y compara su sha256 con el que
anotamos al armar el kit: si no coincide, lo borra y se detiene. Es lo mismo que haces en producción con un modelo:
se fija la revisión y se comprueba la huella antes de usarlo.
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import MODELO, REVISION, TOKENIZER, TOKENIZER_SHA256, TOKENIZER_URL, sha256, tokenizer_sano  # noqa: E402

if __name__ == "__main__":
    if tokenizer_sano():
        print(f"✓ modelo/tokenizer.json ya está y su sha256 coincide ({TOKENIZER_SHA256[:12]}…)")
        sys.exit(0)
    MODELO.mkdir(exist_ok=True)
    print(f"  bajando el tokenizer de multilingual-e5-small, revisión {REVISION[:12]}…")
    with urlopen(TOKENIZER_URL, timeout=120) as r:
        b = r.read()
    if sha256(b) != TOKENIZER_SHA256:
        sys.exit(f"✗ el sha256 no coincide ({sha256(b)[:12]}… en vez de {TOKENIZER_SHA256[:12]}…): no lo guardo")
    TOKENIZER.write_bytes(b)
    print(f"✓ modelo/tokenizer.json: {len(b) / 1e6:.1f} MB, sha256 {TOKENIZER_SHA256[:12]}… (el anotado)")
