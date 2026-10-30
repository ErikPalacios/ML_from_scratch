"""Entrena un MLP chiquito sobre Iris y lo exporta a ONNX dentro del model repository de Triton.

Uso (desde iris-lab/):
    python training/train.py

Resultado: model_repository/iris/1/model.onnx
"""

from pathlib import Path

import numpy as np
import torch
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from torch import nn

SEED = 0
OUT = Path(__file__).resolve().parents[1] / "model_repository" / "iris" / "1" / "model.onnx"


class IrisNet(nn.Module):
    """La normalización vive DENTRO del modelo: el gateway manda features crudas.

    Así no hay dos copias de media/desviación (una en training y otra en serving)
    que se puedan desincronizar: anti training/serving skew.
    """

    def __init__(self, mean: np.ndarray, std: np.ndarray):
        super().__init__()
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.tensor(std, dtype=torch.float32))
        self.net = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 3))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.mean) / self.std
        # Softmax adentro: Triton devuelve probabilidades listas, no logits.
        return torch.softmax(self.net(x), dim=1)


def main() -> None:
    torch.manual_seed(SEED)
    X, y = load_iris(return_X_y=True)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=SEED, stratify=y)

    model = IrisNet(X_tr.mean(axis=0), X_tr.std(axis=0))
    opt = torch.optim.Adam(model.parameters(), lr=0.05)
    loss_fn = nn.NLLLoss()  # el modelo ya devuelve softmax → NLL sobre log(probs)

    Xt = torch.tensor(X_tr, dtype=torch.float32)
    yt = torch.tensor(y_tr)
    for _ in range(200):
        opt.zero_grad()
        loss = loss_fn(torch.log(model(Xt) + 1e-9), yt)
        loss.backward()
        opt.step()

    model.eval()
    with torch.inference_mode():
        pred = model(torch.tensor(X_te, dtype=torch.float32)).argmax(dim=1).numpy()
    print(f"accuracy test: {(pred == y_te).mean():.3f}  (n={len(y_te)})")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (torch.zeros(1, 4),),
        OUT,
        input_names=["input"],
        output_names=["probs"],
        # El batch es dinámico: Triton junta requests (dynamic batching) en un solo forward.
        dynamic_axes={"input": {0: "batch"}, "probs": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    print(f"exportado: {OUT}")


if __name__ == "__main__":
    main()
