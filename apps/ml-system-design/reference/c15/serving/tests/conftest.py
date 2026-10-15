"""Fixtures compartidas de serving/tests: el modelo se entrena UNA vez por sesión, con el pipeline real.

synthetic.py (training/) genera un día de eventos, build_training_set.py arma las filas (visibles, ventana de
30 min, 5 % de los negativos) y train_logreg.py entrena la regresión logística: los tests del ad-api usan un
modelo de verdad, no un fake.
"""

import pytest

import synthetic
import train_logreg


@pytest.fixture(scope="session")
def world():
    # 60 anuncios de 25 anunciantes, sin segmentación: cada test arma su índice y sus casos
    return synthetic.World(seed=11, n_ads=60, n_advertisers=25, targeted=False)


@pytest.fixture(scope="session")
def trained_model(world):
    rows = synthetic.training_rows(world, n_pageviews=60_000, neg_rate=0.05, seed=0)
    return train_logreg.fit_model(rows, version="lr-test")
