"""Cross-check de los modelos `stable-diffusion` y `dit` (SPEC §20): diffusers UNet2DConditionModel, AutoencoderKL y
DiTTransformer2DModel y transformers CLIPTextModel, construidos en código en el dispositivo META (sin pesos ni memoria, sin
hub; hiperparámetros copiados de los config.json publicados, citados abajo). Escribe crosscheck/expected/{sd15-unet,
sd15-train, dit-xl2-256, dit-xl2-512, dit-xl4-256, dit-xl8-256, dit-b2-256, dit-xl2-256-fm}.json.

- Parámetros: sum(p.numel()) de cada módulo (exacto).
- FLOPs: FlopCounterMode sobre tensores meta, atención eager (AttnProcessor: baddbmm + softmax + bmm, sin sdpa); B = 1.
  Stable Diffusion: el grafo del calculador es UN paso de muestreo: encoder de texto (77 tokens) + U-Net (1 evaluación,
  latente 64×64×4) + decoder del VAE (post_quant_conv + decoder), cada uno medido por separado y sumado; sd15-train:
  texto + encoder del VAE (encoder + quant_conv + muestreo de la gaussiana) + U-Net.
- DiT: diffusers DiTTransformer2DModel DUPLICA el embedder de tiempo y clase en cada bloque (AdaLayerNormZero con su propio
  CombinedTimestepLabelEmbeddings; el script de conversión copia los mismos pesos 28 veces) y lo vuelve a correr para la
  capa final. El código oficial (facebookresearch/DiT, models.py) tiene UN t_embedder y UN y_embedder. Se mide todo con
  diffusers y se restan las copias (parámetros de los bloques 1…L−1 y FLOPs de las L llamadas extra, medidos por módulo):
  el resultado es el modelo oficial salvo la posición sin/cos, que el oficial guarda como nn.Parameter(requires_grad=False)
  (N·D valores; el calculador la cuenta como buffer, como diffusers). Ver notes y params_total_diffusers_raw.

Configs publicados (copiados a mano, sin descargar):
- stable-diffusion-v1-5/stable-diffusion-v1-5: unet/config.json, vae/config.json, text_encoder/config.json,
  scheduler/scheduler_config.json (PNDM; DDIM con los mismos β).
- facebook/DiT-XL-2-256 y facebook/DiT-XL-2-512: transformer/config.json; vae = stabilityai/sd-vae-ft-ema (misma arquitectura
  que el VAE de SD).

Uso: .venv/bin/python crosscheck/diffusion.py
"""
import importlib.metadata as md

import torch
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import diffusers  # noqa: E402
import transformers  # noqa: E402
from diffusers import AutoencoderKL, DDIMScheduler, DiTTransformer2DModel, PNDMScheduler, UNet2DConditionModel  # noqa: E402
from diffusers.models.attention_processor import Attention, AttnProcessor  # noqa: E402
from transformers import CLIPTextConfig, CLIPTextModel, CLIPTextModelWithProjection  # noqa: E402

# ---------------------------------------------------------------- configs (deben coincidir con js/arch/diffusion.js)
SD15_UNET = dict(act_fn="silu", attention_head_dim=8, block_out_channels=[320, 640, 1280, 1280], center_input_sample=False,
                 cross_attention_dim=768, down_block_types=["CrossAttnDownBlock2D", "CrossAttnDownBlock2D", "CrossAttnDownBlock2D", "DownBlock2D"],
                 downsample_padding=1, flip_sin_to_cos=True, freq_shift=0, in_channels=4, layers_per_block=2, mid_block_scale_factor=1,
                 norm_eps=1e-5, norm_num_groups=32, out_channels=4, sample_size=64,
                 up_block_types=["UpBlock2D", "CrossAttnUpBlock2D", "CrossAttnUpBlock2D", "CrossAttnUpBlock2D"])
SD_VAE = dict(act_fn="silu", block_out_channels=[128, 256, 512, 512], down_block_types=["DownEncoderBlock2D"] * 4, in_channels=3,
              latent_channels=4, layers_per_block=2, norm_num_groups=32, out_channels=3, sample_size=512, up_block_types=["UpDecoderBlock2D"] * 4,
              scaling_factor=0.18215)
CLIP_L_TEXT = dict(vocab_size=49408, hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12,
                   max_position_embeddings=77, hidden_act="quick_gelu", projection_dim=768, layer_norm_eps=1e-5)
SD_SCHED = dict(num_train_timesteps=1000, beta_start=0.00085, beta_end=0.012, beta_schedule="scaled_linear", steps_offset=1,
                clip_sample=False, set_alpha_to_one=False)
T_TEXT = 77
# stabilityai/stable-diffusion-xl-base-1.0: unet/config.json y text_encoder_2/config.json (text_encoder = CLIP_L_TEXT; vae = SD_VAE con
# scaling_factor 0.13025)
SDXL_UNET = dict(act_fn="silu", addition_embed_type="text_time", addition_embed_type_num_heads=64, addition_time_embed_dim=256,
                 attention_head_dim=[5, 10, 20], block_out_channels=[320, 640, 1280], center_input_sample=False, cross_attention_dim=2048,
                 down_block_types=["DownBlock2D", "CrossAttnDownBlock2D", "CrossAttnDownBlock2D"], downsample_padding=1, flip_sin_to_cos=True,
                 freq_shift=0, in_channels=4, layers_per_block=2, mid_block_scale_factor=1, norm_eps=1e-5, norm_num_groups=32, out_channels=4,
                 projection_class_embeddings_input_dim=2816, sample_size=128, transformer_layers_per_block=[1, 2, 10],
                 up_block_types=["CrossAttnUpBlock2D", "CrossAttnUpBlock2D", "UpBlock2D"], use_linear_projection=True)
BIGG_TEXT = dict(vocab_size=49408, hidden_size=1280, intermediate_size=5120, num_hidden_layers=32, num_attention_heads=20,
                 max_position_embeddings=77, hidden_act="gelu", projection_dim=1280, layer_norm_eps=1e-5)

DIT_XL = dict(num_layers=28, num_attention_heads=16, attention_head_dim=72)
DIT_B = dict(num_layers=12, num_attention_heads=12, attention_head_dim=64)
DIT = {
    "dit-xl2-256": dict(DIT_XL, patch_size=2, res=256, out_channels=8, hf="facebook/DiT-XL-2-256"),
    "dit-xl2-512": dict(DIT_XL, patch_size=2, res=512, out_channels=8, hf="facebook/DiT-XL-2-512"),
    "dit-xl4-256": dict(DIT_XL, patch_size=4, res=256, out_channels=8, hf=None),
    "dit-xl8-256": dict(DIT_XL, patch_size=8, res=256, out_channels=8, hf=None),
    "dit-b2-256": dict(DIT_B, patch_size=2, res=256, out_channels=8, hf=None),
    "dit-xl2-256-fm": dict(DIT_XL, patch_size=2, res=256, out_channels=4, hf=None),
}


def eager(model):
    for m in model.modules():
        if isinstance(m, Attention):
            m.set_processor(AttnProcessor())
    return model


def meta(ctor):
    with torch.device("meta"):
        m = ctor()
    m.eval()
    return m


def count(fn):
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = fn()
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    by_mod = {k: sum(int(v) for v in d.values()) for k, d in counts.items() if k != "Global"}
    return int(fcm.get_total_flops()), by_op, by_mod, out


def merge_ops(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            out[k] = out.get(k, 0) + v
    return dict(sorted(out.items()))


class Rec:
    """Formas de salida / entrada de módulos por nombre, sin batch (B = 1) y rejillas C×H×W → H×W×C."""

    def __init__(self):
        self.raw, self.handles, self.patched = {}, [], []

    def put(self, tid, shape, grid=False):
        s = list(shape)
        assert s[0] == 1, f"se esperaba B = 1 en {tid}: {s}"
        s = s[1:]
        if grid and len(s) == 3:
            s = [s[1], s[2], s[0]]
        self.raw.setdefault(tid, s)

    def hook(self, model, name, where, tid, grid=False):
        m = dict(model.named_modules())[name]
        if where == "out":
            def h(mod, inp, out):
                t = out[0] if isinstance(out, (tuple, list)) else out
                if hasattr(t, "sample"):
                    t = t.sample
                self.put(tid, t.shape, grid)
            self.handles.append(m.register_forward_hook(h))
        else:
            def p(mod, inp):
                self.put(tid, inp[0].shape, grid)
            self.handles.append(m.register_forward_pre_hook(p))

    def scores(self, model, name, tid):
        """Pesos de atención (B·h)×N×M de Attention.get_attention_scores de ese módulo → h×N×M."""
        m = dict(model.named_modules())[name]
        orig = m.get_attention_scores

        def f(q, k, mask=None):
            out = orig(q, k, mask)
            self.raw.setdefault(tid, list(out.shape))
            return out
        m.get_attention_scores = f
        self.patched.append((m, orig))

    def remove(self):
        for h in self.handles:
            h.remove()
        for m, orig in self.patched:
            m.get_attention_scores = orig


def lib_versions():
    v = versions()
    v["diffusers"] = md.version("diffusers")
    return v


# ---------------------------------------------------------------- Stable Diffusion
def sd_models():
    unet = eager(meta(lambda: UNet2DConditionModel(**SD15_UNET)))
    vae = eager(meta(lambda: AutoencoderKL(**SD_VAE)))
    te = meta(lambda: CLIPTextModel(CLIPTextConfig(**CLIP_L_TEXT)))
    te.config._attn_implementation = "eager"
    return unet, vae, te


def sd_text(te, rec=None):
    ids = torch.zeros(1, T_TEXT, dtype=torch.long, device="meta")
    if rec:
        rec.hook(te, "embeddings", "out", "t-x0")
        rec.hook(te, "encoder.layers.0.mlp.fc1", "out", "t-u")
        rec.hook(te, "final_layer_norm", "out", "text-emb")
    return count(lambda: te(ids))


def sd_unet(unet, res, rec=None):
    lat = res // 8
    z = torch.zeros(1, 4, lat, lat, device="meta")
    t = torch.tensor([999], device="meta")
    enc = torch.zeros(1, T_TEXT, 768, device="meta")
    if rec:
        U = rec.hook
        U(unet, "conv_in", "in", "z-t", True)
        U(unet, "conv_in", "out", "h-in", True)
        U(unet, "time_proj", "out", "t-freq")
        U(unet, "time_embedding", "out", "temb")
        U(unet, "down_blocks.0.resnets.0.time_emb_proj", "out", "d1-res1-e-proj")
        U(unet, "down_blocks.0.resnets.0", "out", "d1-res1-out", True)
        U(unet, "down_blocks.0.attentions.0.transformer_blocks.0", "in", "d1-attn1-x0")
        U(unet, "down_blocks.0.attentions.0.transformer_blocks.0.attn1.to_q", "out", "d1-attn1-sa-q")
        U(unet, "down_blocks.0.attentions.0.transformer_blocks.0.attn2.to_k", "out", "d1-attn1-ca-k")
        U(unet, "down_blocks.0.attentions.0.transformer_blocks.0.ff.net.0.proj", "out", "d1-attn1-ff-h")
        U(unet, "down_blocks.0.attentions.0.transformer_blocks.0.ff.net.0", "out", "d1-attn1-ff-g")
        U(unet, "down_blocks.0.attentions.0", "out", "d1-attn1-out", True)
        U(unet, "down_blocks.0.downsamplers.0", "out", "d1-down-out", True)
        U(unet, "down_blocks.1.resnets.0.conv_shortcut", "out", "d2-res1-skip", True)
        U(unet, "down_blocks.2.attentions.1", "out", "d3-attn2-out", True)
        U(unet, "down_blocks.3.resnets.1", "out", "d4-res2-out", True)
        U(unet, "mid_block.attentions.0", "out", "mid-attn-out", True)
        U(unet, "up_blocks.0.resnets.0", "in", "u1-cat1", True)
        U(unet, "up_blocks.0.upsamplers.0", "out", "u1-up-out", True)
        U(unet, "up_blocks.1.resnets.2", "in", "u2-cat3", True)
        U(unet, "up_blocks.2.resnets.0", "in", "u3-cat1", True)
        U(unet, "up_blocks.3.resnets.2", "out", "u4-res3-out", True)
        U(unet, "conv_out", "out", "eps-hat", True)
        rec.scores(unet, "down_blocks.0.attentions.0.transformer_blocks.0.attn1", "d1-attn1-sa-attn")
        rec.scores(unet, "down_blocks.0.attentions.0.transformer_blocks.0.attn2", "d1-attn1-ca-attn")
        rec.scores(unet, "mid_block.attentions.0.transformer_blocks.0.attn1", "mid-attn-sa-attn")
    return count(lambda: unet(z, t, encoder_hidden_states=enc))


def sd_decode(vae, res, rec=None):
    z = torch.zeros(1, 4, res // 8, res // 8, device="meta")
    if rec:
        V = rec.hook
        V(vae, "post_quant_conv", "out", "vd-pq", True)
        V(vae, "decoder.conv_in", "out", "vd-h-in", True)
        V(vae, "decoder.mid_block.attentions.0", "out", "vd-mid-attn-out", True)
        V(vae, "decoder.up_blocks.0.upsamplers.0", "out", "vd-u1-up-out", True)
        V(vae, "decoder.up_blocks.2.resnets.0.conv_shortcut", "out", "vd-u3-res1-skip", True)
        V(vae, "decoder.up_blocks.3.resnets.2", "out", "vd-u4-res3-out", True)
        V(vae, "decoder.conv_out", "out", "image", True)
        rec.scores(vae, "decoder.mid_block.attentions.0", "vd-mid-attn-sa-attn")
    return count(lambda: vae.decode(z))


def sd_encode(vae, res, rec=None):
    img = torch.zeros(1, 3, res, res, device="meta")
    if rec:
        V = rec.hook
        V(vae, "encoder.conv_in", "out", "ve-h-in", True)
        V(vae, "encoder.down_blocks.0.downsamplers.0", "out", "ve-d1-down-out", True)
        V(vae, "encoder.down_blocks.1.resnets.0.conv_shortcut", "out", "ve-d2-res1-skip", True)
        V(vae, "encoder.mid_block.attentions.0", "out", "ve-mid-attn-out", True)
        V(vae, "encoder.conv_out", "out", "ve-h-out", True)
        V(vae, "quant_conv", "out", "ve-moments", True)
        rec.scores(vae, "encoder.mid_block.attentions.0", "ve-mid-attn-sa-attn")
    return count(lambda: vae.encode(img).latent_dist.sample())


SD_GROUPS = [{"ops": ["aten.convolution"], "prims": ["conv2d", "downsample2d"]},
             {"ops": ["aten.addmm", "aten.mm"], "prims": ["linear"]},
             {"ops": ["aten.baddbmm", "aten.bmm"], "prims": ["attention_scores", "attention_weighted_sum"]}]


def sd_ctor():
    return ("with torch.device('meta'): UNet2DConditionModel(**unet_config), AutoencoderKL(**vae_config), CLIPTextModel(CLIPTextConfig(vocab_size=49408, "
            "hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12, max_position_embeddings=77, hidden_act='quick_gelu')); "
            "set_processor(AttnProcessor()) en cada Attention (eager)")


def schedule_checks():
    """ᾱ_t del scheduler de SD (scaled_linear, float32 en diffusers) y pasos de DDIM / PNDM para varios n."""
    dd = DDIMScheduler(**SD_SCHED)
    ac = dd.alphas_cumprod
    out = {"alphas_cumprod": {str(t): float(ac[t]) for t in (0, 99, 249, 499, 749, 999)}, "ddim_timesteps": {}, "pndm_nfe": {}}
    for n in (10, 25, 50):
        dd.set_timesteps(n)
        out["ddim_timesteps"][str(n)] = [int(x) for x in dd.timesteps]
        pn = PNDMScheduler(skip_prk_steps=True, set_alpha_to_one=False, steps_offset=1, num_train_timesteps=1000, beta_start=0.00085, beta_end=0.012,
                           beta_schedule="scaled_linear")
        pn.set_timesteps(n)
        out["pndm_nfe"][str(n)] = int(len(pn.timesteps))
    return out


def run_sd(config_id, train):
    unet, vae, te = sd_models()
    res = 512
    rec = Rec()
    ft, ot, mt, _ = sd_text(te, rec)
    fu, ou, mu, _ = sd_unet(unet, res, rec)
    if train:
        fv, ov_, mv, _ = sd_encode(vae, res, rec)
    else:
        fv, ov_, mv, _ = sd_decode(vae, res, rec)
    rec.remove()
    shapes = dict(rec.raw)
    shapes["prompt-ids"] = [T_TEXT]
    pe, pd = n_params(vae.encoder) + n_params(vae.quant_conv), n_params(vae.decoder) + n_params(vae.post_quant_conv)
    pb = {"unet": n_params(unet), "text-encoder": n_params(te), "vae-encoder": pe, "vae-decoder": pd,
          "time-embed": n_params(unet.time_embedding), "conv-in": n_params(unet.conv_in),
          "down-1": n_params(unet.down_blocks[0]), "down-2": n_params(unet.down_blocks[1]), "down-3": n_params(unet.down_blocks[2]), "down-4": n_params(unet.down_blocks[3]),
          "mid": n_params(unet.mid_block), "up-1": n_params(unet.up_blocks[0]), "up-2": n_params(unet.up_blocks[1]), "up-3": n_params(unet.up_blocks[2]),
          "up-4": n_params(unet.up_blocks[3]), "conv-out": n_params(unet.conv_norm_out) + n_params(unet.conv_out),
          "d1-attn1": n_params(unet.down_blocks[0].attentions[0]), "d2-res1": n_params(unet.down_blocks[1].resnets[0]),
          "u1-res1": n_params(unet.up_blocks[0].resnets[0]), "mid-attn": n_params(unet.mid_block.attentions[0])}
    assert pe + pd == n_params(vae)
    params_total = n_params(unet) + n_params(te) + n_params(vae)
    U = "UNet2DConditionModel."
    fbn = {"unet": fu, "text-encoder": ft, ("vae-encoder" if train else "vae-decoder"): fv,
           "time-embed": mu.get(U + "time_embedding", 0), "conv-in": mu.get(U + "conv_in", 0),
           "down-1": mu.get(U + "down_blocks.0", 0), "down-2": mu.get(U + "down_blocks.1", 0), "down-3": mu.get(U + "down_blocks.2", 0), "down-4": mu.get(U + "down_blocks.3", 0),
           "mid": mu.get(U + "mid_block", 0), "up-1": mu.get(U + "up_blocks.0", 0), "up-2": mu.get(U + "up_blocks.1", 0), "up-3": mu.get(U + "up_blocks.2", 0),
           "up-4": mu.get(U + "up_blocks.3", 0), "conv-out": mu.get(U + "conv_out", 0),
           "d1-attn1": mu.get(U + "down_blocks.0.attentions.0", 0), "d2-res1": mu.get(U + "down_blocks.1.resnets.0", 0), "mid-attn": mu.get(U + "mid_block.attentions.0", 0)}
    by_op = merge_ops(ot, ou, ov_)
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm", "aten.baddbmm"}, by_op
    flops = ft + fu + fv
    # overrides: otra resolución (texto + U-Net + VAE) y el mismo paso con el VAE del otro lado (para las métricas)
    oc = []
    for r2 in (256, 1024):
        f2 = sd_text(te)[0] + sd_unet(unet, r2)[0] + (sd_encode(vae, r2)[0] if train else sd_decode(vae, r2)[0])
        oc.append({"calc_overrides": {"res": r2}, "params_total": params_total, "flops_total": f2})
    fe = sd_encode(vae, res)[0]
    fd = sd_decode(vae, res)[0]
    mc = {"unetParams": n_params(unet), "textEncoderParams": n_params(te), "vaeEncoderParams": pe, "vaeDecoderParams": pd, "vaeParams": n_params(vae),
          "unetMacs": fu // 2, "textEncoderMacs": ft // 2, "vaeEncoderMacs": fe // 2, "vaeDecoderMacs": fd // 2,
          "latentTokens": (res // 8) ** 2, "totalParams": params_total}
    notes = [
        "Modelos construidos en código en el dispositivo meta (sin pesos ni hub; hiperparámetros de stable-diffusion-v1-5: unet/config.json, vae/config.json, text_encoder/config.json); parámetros exactos con sum(p.numel()).",
        ("Grafo = un paso de ENTRENAMIENTO: encoder de texto (77 tokens) + encoder del VAE (512×512 → momentos 64×64×8 → z, con quant_conv) + U-Net (1 evaluación, latente 64×64×4, B = 1). "
         if train else
         "Grafo = UN paso de muestreo por imagen: encoder de texto (77 tokens) + U-Net (1 evaluación = 1 NFE, latente 64×64×4, B = 1) + decoder del VAE (post_quant_conv + decoder, 64×64×4 → 512×512×3). ")
        + "FLOPs = suma de los tres forwards medidos por separado con FlopCounterMode (2 FLOPs por MAC de conv / matmul / baddbmm / bmm). El costo por imagen (pasos × NFE × 2 con CFG + texto + VAE) lo arma metrics() con estos números.",
        "Parámetros = el checkpoint entero (U-Net 859,520,964 + VAE 83,653,863 + texto 123,060,480): el calculador cuenta la parte del VAE que este grafo no usa como idle_params.",
        "Atención eager (AttnProcessor: baddbmm con β = 0 para QKᵀ, softmax, bmm para A·V): mismos FLOPs que sdpa en FlopCounterMode. U-Net: to_q/to_k/to_v sin sesgo, to_out con sesgo; cross-attention con K y V de los 77 × 768 del texto. VAE: atención de 1 cabeza (head_dim 512) con sesgo en Q, K, V y salida.",
        "attention_head_dim = 8 en la config de SD 1.x es el NÚMERO de cabezas (8), no su dimensión (40/80/160): nombre histórico de diffusers.",
        "Encoder del VAE: Downsample2D con padding 0 y relleno (0, 1, 0, 1) antes de la conv 3×3 stride 2 (el calculador: downsample2d pad 'asym'); la U-Net usa padding 1.",
        "El muestreo de la gaussiana (latent_dist.sample) y la escala × 0.18215 son elementwise: 0 FLOPs.",
        "schedule_checks: alphas_cumprod del scheduler de SD (β scaled_linear 0.00085 → 0.012, 1,000 pasos, float32 en diffusers) ↔ ATLAS.Arch.diffusion.alphasCumprod (float64), pasos de DDIM (timestep_spacing 'leading', steps_offset 1) ↔ ddimTimesteps y evaluaciones de PNDM (skip_prk_steps: n + 1) ↔ pndmNfe.",
    ]
    data = {
        "config_id": config_id, "model": "stable-diffusion", "res": res, "T": T_TEXT, "train": int(train),
        "params_total": params_total, "params_by_node": pb, "shapes": shapes,
        "flops_total": flops, "flops_by_node": fbn, "flops_by_op_torch": by_op, "flops_by_op_groups": SD_GROUPS,
        "override_checks": oc, "metrics_checks": mc, "schedule_checks": schedule_checks(),
        "not_hooked": {"z0": "el latente escalado sale de latent_dist.sample() × 0.18215 (no es un módulo)", "eps-guided": "CFG lo hace el pipeline, no un módulo",
                       "z-prev": "el paso del scheduler no es un módulo"},
        "hf_config_source": "stable-diffusion-v1-5/stable-diffusion-v1-5",
        "source": {"lib": "diffusers", "version": diffusers.__version__, "transformers": transformers.__version__, "ctor": sd_ctor(),
                   "unet_config": SD15_UNET, "vae_config": SD_VAE, "text_config": CLIP_L_TEXT, "scheduler_config": SD_SCHED, "versions": lib_versions()},
        "notes": notes,
    }
    write_expected(config_id, data)


# ---------------------------------------------------------------- SDXL (base, sin refiner)
# la última capa de cada encoder de texto es una op compuesta (transformer_block: lineales + atención): un solo grupo de matmuls
SDXL_GROUPS = [{"ops": ["aten.convolution"], "prims": ["conv2d", "downsample2d"]},
               {"ops": ["aten.addmm", "aten.mm", "aten.baddbmm", "aten.bmm"], "prims": ["linear", "attention_scores", "attention_weighted_sum", "transformer_block"]}]
def run_sdxl(config_id):
    unet = eager(meta(lambda: UNet2DConditionModel(**SDXL_UNET)))
    vae = eager(meta(lambda: AutoencoderKL(**dict(SD_VAE, scaling_factor=0.13025))))
    te1 = meta(lambda: CLIPTextModel(CLIPTextConfig(**CLIP_L_TEXT)))
    te2 = meta(lambda: CLIPTextModelWithProjection(CLIPTextConfig(**BIGG_TEXT)))
    for te in (te1, te2):
        te.config._attn_implementation = "eager"
    res = 1024
    lat = res // 8
    rec = Rec()
    ids = torch.zeros(1, T_TEXT, dtype=torch.long, device="meta")
    R = rec.hook
    R(te1, "embeddings", "out", "te1-x0")
    R(te1, "encoder.layers.10", "out", "te1-hidden")
    R(te1, "encoder.layers.0.mlp.fc1", "out", "te1-u")
    R(te2, "text_model.embeddings", "out", "te2-x0")
    R(te2, "text_model.encoder.layers.30", "out", "te2-hidden")
    R(te2, "text_model.encoder.layers.0.mlp.fc1", "out", "te2-u")
    R(te2, "text_projection", "out", "text-pooled")
    f1, o1, _, _ = count(lambda: te1(ids, output_hidden_states=True))
    f2, o2, _, _ = count(lambda: te2(ids, output_hidden_states=True))
    z = torch.zeros(1, 4, lat, lat, device="meta")
    t = torch.tensor([999], device="meta")
    enc = torch.zeros(1, T_TEXT, 2048, device="meta")
    added = {"text_embeds": torch.zeros(1, 1280, device="meta"), "time_ids": torch.zeros(1, 6, device="meta")}
    R(unet, "conv_in", "in", "z-t", True)
    R(unet, "conv_in", "out", "h-in", True)
    R(unet, "time_embedding", "out", "temb")
    R(unet, "add_embedding", "in", "add-in")
    R(unet, "add_embedding", "out", "add-emb")
    R(unet, "down_blocks.0.resnets.0", "out", "d1-res1-out", True)
    R(unet, "down_blocks.1.attentions.0.transformer_blocks.0", "in", "d2-attn1-x0")
    R(unet, "down_blocks.1.attentions.0.transformer_blocks.0.attn2.to_k", "in", "text-emb")
    R(unet, "down_blocks.1.attentions.0.transformer_blocks.0.ff.net.0.proj", "out", "d2-attn1-ff-h")
    R(unet, "down_blocks.1.attentions.0", "out", "d2-attn1-out", True)
    R(unet, "down_blocks.2.attentions.1", "out", "d3-attn2-out", True)
    R(unet, "mid_block.attentions.0", "out", "mid-attn-out", True)
    R(unet, "up_blocks.0.resnets.0", "in", "u1-cat1", True)
    R(unet, "up_blocks.0.upsamplers.0", "out", "u1-up-out", True)
    R(unet, "up_blocks.2.resnets.2", "out", "u3-res3-out", True)
    R(unet, "conv_out", "out", "eps-hat", True)
    rec.scores(unet, "down_blocks.1.attentions.0.transformer_blocks.0.attn1", "d2-attn1-sa-attn")
    rec.scores(unet, "down_blocks.2.attentions.0.transformer_blocks.0.attn2", "d3-attn1-ca-attn")
    fu, ou, mu, _ = count(lambda: unet(z, t, encoder_hidden_states=enc, added_cond_kwargs=added))
    fd, od, _, _ = sd_decode(vae, res, rec)
    rec.remove()
    shapes = dict(rec.raw)
    shapes["prompt-ids"] = [T_TEXT]
    pe, pd = n_params(vae.encoder) + n_params(vae.quant_conv), n_params(vae.decoder) + n_params(vae.post_quant_conv)
    pb = {"unet": n_params(unet), "text-encoder": n_params(te1) + n_params(te2), "te1": n_params(te1), "te2": n_params(te2), "vae-encoder": pe, "vae-decoder": pd,
          "add-embed": n_params(unet.add_embedding), "conv-in": n_params(unet.conv_in), "down-1": n_params(unet.down_blocks[0]), "down-2": n_params(unet.down_blocks[1]),
          "down-3": n_params(unet.down_blocks[2]), "mid": n_params(unet.mid_block), "up-1": n_params(unet.up_blocks[0]), "up-2": n_params(unet.up_blocks[1]),
          "up-3": n_params(unet.up_blocks[2]), "d3-attn1": n_params(unet.down_blocks[2].attentions[0]), "mid-attn": n_params(unet.mid_block.attentions[0])}
    # time-embed = time_embedding + add_embedding (el calculador pone el micro-condicionamiento bajo time-embed › add-embed)
    pb["time-embed"] = n_params(unet.time_embedding) + n_params(unet.add_embedding)
    params_total = n_params(unet) + n_params(te1) + n_params(te2) + n_params(vae)
    U = "UNet2DConditionModel."
    fbn = {"unet": fu, "text-encoder": f1 + f2, "te1": f1, "te2": f2, "vae-decoder": fd, "add-embed": mu.get(U + "add_embedding", 0),
           "time-embed": mu.get(U + "time_embedding", 0) + mu.get(U + "add_embedding", 0),
           "down-1": mu.get(U + "down_blocks.0", 0), "down-2": mu.get(U + "down_blocks.1", 0), "down-3": mu.get(U + "down_blocks.2", 0), "mid": mu.get(U + "mid_block", 0),
           "up-1": mu.get(U + "up_blocks.0", 0), "up-2": mu.get(U + "up_blocks.1", 0), "up-3": mu.get(U + "up_blocks.2", 0), "d3-attn1": mu.get(U + "down_blocks.2.attentions.0", 0)}
    by_op = merge_ops(o1, o2, ou, od)
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm", "aten.baddbmm"}, by_op
    flops = f1 + f2 + fu + fd
    fe = sd_encode(vae, res)[0]
    mc = {"unetParams": n_params(unet), "textEncoderParams": n_params(te1) + n_params(te2), "vaeEncoderParams": pe, "vaeDecoderParams": pd, "vaeParams": n_params(vae),
          "unetMacs": fu // 2, "textEncoderMacs": (f1 + f2) // 2, "vaeEncoderMacs": fe // 2, "vaeDecoderMacs": fd // 2, "latentTokens": lat * lat, "totalParams": params_total}
    oc = []
    for r2 in (512, 768):
        l2 = r2 // 8
        f_u = count(lambda: unet(torch.zeros(1, 4, l2, l2, device="meta"), t, encoder_hidden_states=enc, added_cond_kwargs=added))[0]
        oc.append({"calc_overrides": {"res": r2}, "params_total": params_total, "flops_total": f1 + f2 + f_u + sd_decode(vae, r2)[0]})
    notes = [
        "Modelos construidos en código en el dispositivo meta (sin pesos ni hub; hiperparámetros de stabilityai/stable-diffusion-xl-base-1.0: unet/config.json, text_encoder, text_encoder_2, vae): parámetros exactos con sum(p.numel()). Sin el refiner.",
        f"Grafo = UN paso de muestreo a {res}×{res}: los dos encoders de texto (77 tokens; output_hidden_states = True: SDXL usa hidden_states[−2] de los dos, concatenados a 77 × 2,048, y el text_embeds agrupado del segundo) + U-Net (1 NFE, latente {lat}×{lat}×4, con added_cond_kwargs: text_embeds 1,280 y 6 time ids) + decoder del VAE. FLOPs = suma de los cuatro forwards (FlopCounterMode, atención eager).",
        "HF corre TODAS las capas de los dos encoders (también la última, que SDXL no usa salvo para el vector agrupado del segundo) y la LayerNorm final: se cuentan (el calculador: op last-layer de cada torre).",
        "U-Net de SDXL: 3 niveles (320, 640, 1280), sin atención en el primero (64×64… a 1024 son 128×128 = 16,384 tokens: demasiado caro), 2 y 10 bloques transformer por bloque en los niveles 2 y 3 y 10 en el medio; use_linear_projection (proj_in/proj_out Linear en vez de conv 1×1: mismos parámetros y MACs); d_h = 64 (attention_head_dim [5, 10, 20] = cabezas).",
        "Micro-condicionamiento (addition_embed_type text_time): 6 time ids → sinusoides de 256 (1,536) + text_embeds (1,280) = 2,816 → TimestepEmbedding(2816 → 1280) sumado al embedding del tiempo.",
        "Los dos tokenizers de SDXL comparten el vocabulario BPE de 49,408 (cambia el token de relleno): el calculador usa un solo tensor de ids.",
    ]
    data = {
        "config_id": config_id, "model": "stable-diffusion", "res": res, "T": T_TEXT, "train": 0,
        "params_total": params_total, "params_by_node": pb, "shapes": shapes,
        "flops_total": flops, "flops_by_node": fbn, "flops_by_op_torch": by_op, "flops_by_op_groups": SDXL_GROUPS,
        "override_checks": oc, "metrics_checks": mc,
        "not_hooked": {"text-concat": "torch.cat del pipeline (no es un módulo)", "time-ids-emb": "add_time_proj recibe los ids aplanados (sin dimensión de batch)"},
        "hf_config_source": "stabilityai/stable-diffusion-xl-base-1.0",
        "source": {"lib": "diffusers", "version": diffusers.__version__, "transformers": transformers.__version__,
                   "ctor": "with torch.device('meta'): UNet2DConditionModel(**sdxl_unet_config), AutoencoderKL(**vae_config, scaling_factor=0.13025), CLIPTextModel(CLIPTextConfig(ViT-L/14 texto)), CLIPTextModelWithProjection(CLIPTextConfig(bigG texto)); AttnProcessor (eager)",
                   "unet_config": SDXL_UNET, "text_config": CLIP_L_TEXT, "text_config_2": BIGG_TEXT, "versions": lib_versions()},
        "notes": notes,
    }
    write_expected(config_id, data)


# ---------------------------------------------------------------- DiT
def dit_model(c):
    lat = c["res"] // 8
    kw = dict(num_attention_heads=c["num_attention_heads"], attention_head_dim=c["attention_head_dim"], in_channels=4, out_channels=c["out_channels"],
              num_layers=c["num_layers"], sample_size=lat, patch_size=c["patch_size"], activation_fn="gelu-approximate", num_embeds_ada_norm=1000,
              norm_type="ada_norm_zero", norm_elementwise_affine=False, attention_bias=True, norm_num_groups=32)
    return eager(meta(lambda: DiTTransformer2DModel(**kw))), kw


def dit_forward(model, c, rec=None):
    lat = c["res"] // 8
    x = torch.zeros(1, 4, lat, lat, device="meta")
    t = torch.tensor([999], device="meta")
    y = torch.tensor([1], device="meta")
    if rec:
        R = rec.hook
        R(model, "pos_embed.proj", "out", "x-patch-grid", True)
        R(model, "pos_embed", "out", "h0")
        R(model, "transformer_blocks.0.norm1.emb.time_proj", "out", "t-freq")
        R(model, "transformer_blocks.0.norm1.emb.timestep_embedder", "out", "t-emb")
        R(model, "transformer_blocks.0.norm1.emb.class_embedder", "out", "y-emb")
        R(model, "transformer_blocks.0.attn1", "in", "h-mod1")
        R(model, "transformer_blocks.0.attn1.to_out.0", "out", "o")
        R(model, "transformer_blocks.0.ff", "in", "h-mod2")
        R(model, "transformer_blocks.0.ff.net.0.proj", "out", "u")
        R(model, "transformer_blocks.0.ff.net.2", "out", "f")
        R(model, f"transformer_blocks.{c['num_layers'] - 1}", "out", "x-out")
        R(model, "proj_out_2", "out", "h-final")
        rec.scores(model, "transformer_blocks.0.attn1", "attn")
    flops, by_op, by_mod, out = count(lambda: model(x, timestep=t, class_labels=y))
    return flops, by_op, by_mod, out


def dup_embedders(model, c, by_mod):
    """Parámetros de las L − 1 copias del embedder (bloques 1…L−1) y FLOPs de sus L llamadas extra (bloques 1…L−1 y la
    segunda llamada del bloque 0, para la capa final)."""
    L = c["num_layers"]
    cls = type(model).__name__
    emb = [model.transformer_blocks[i].norm1.emb for i in range(L)]
    p_one = n_params(emb[0])
    p_dup = sum(n_params(e) for e in emb[1:])
    f_blocks = [by_mod.get(f"{cls}.transformer_blocks.{i}.norm1.emb", 0) for i in range(L)]
    f_dup = sum(f_blocks[1:]) + f_blocks[0] // 2
    assert all(f == f_blocks[1] for f in f_blocks[1:]) and f_blocks[0] == 2 * f_blocks[1], f_blocks
    return p_one, p_dup, f_dup, f_blocks[1]


def run_dit(config_id):
    c = DIT[config_id]
    model, kw = dit_model(c)
    lat, P, L = c["res"] // 8, c["patch_size"], c["num_layers"]
    N = (lat // P) ** 2
    D = c["num_attention_heads"] * c["attention_head_dim"]
    rec = Rec()
    flops_raw, by_op, by_mod, out = dit_forward(model, c, rec)
    rec.remove()
    shapes = dict(rec.raw)
    shapes["attn"] = shapes["attn"]   # (B·h)×N×N con B = 1 → h×N×N
    sample = list(out.sample.shape)
    assert sample[0] == 1
    oc_ = c["out_channels"]
    shapes["v-hat" if oc_ == 4 else "out"] = [sample[2], sample[3], sample[1]]
    if oc_ == 8:
        shapes["eps-hat"] = [lat, lat, 4]
        shapes["sigma"] = [lat, lat, 4]
    params_raw = n_params(model)
    p_one, p_dup, f_dup, f_emb = dup_embedders(model, c, by_mod)
    params_total = params_raw - p_dup
    flops = flops_raw - f_dup
    pos_buffer = int(model.pos_embed.pos_embed.numel())
    assert pos_buffer == N * D
    blocks = model.transformer_blocks
    b0 = blocks[0]
    blk = n_params(b0) - p_one                            # un bloque sin su copia del embedder
    pb = {"patchify": n_params(model.pos_embed), "t-embed": n_params(b0.norm1.emb.timestep_embedder), "y-embed": n_params(b0.norm1.emb.class_embedder),
          "blocks": L * blk, "adaln": L * n_params(b0.norm1.linear), "adaln-final": n_params(model.proj_out_1), "attn": L * n_params(b0.attn1), "mlp": L * n_params(b0.ff),
          "final-layer": n_params(model.proj_out_1) + n_params(model.proj_out_2)}
    cls = type(model).__name__
    fbn = {"patchify": by_mod.get(cls + ".pos_embed", 0), "t-embed": f_emb, "final-layer": by_mod.get(cls + ".proj_out_1", 0) + by_mod.get(cls + ".proj_out_2", 0),
           "attn": sum(by_mod.get(f"{cls}.transformer_blocks.{i}.attn1", 0) for i in range(L)),
           "mlp": sum(by_mod.get(f"{cls}.transformer_blocks.{i}.ff", 0) for i in range(L)),
           "adaln": sum(by_mod.get(f"{cls}.transformer_blocks.{i}.norm1.linear", 0) for i in range(L)), "adaln-final": by_mod.get(cls + ".proj_out_1", 0)}
    # también por ruta (bloques y capa final)
    pbp = {"blocks>block>adaln": L * n_params(b0.norm1.linear), "final-layer>adaln-final": n_params(model.proj_out_1), "final-layer>linear": n_params(model.proj_out_2),
           "blocks>block>attn": L * n_params(b0.attn1), "blocks>block>mlp": L * n_params(b0.ff)}
    if oc_ == 4:   # flow matching: la red va bajo el nodo `model` (path model › …)
        pbp = {"model>" + k: v for k, v in pbp.items()}
        pbp["model"] = params_total
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm", "aten.baddbmm"}, by_op
    # FLOPs por operador sin las llamadas duplicadas del embedder (todas son addmm: dos Linear con sesgo)
    by_op_official = dict(by_op)
    by_op_official["aten.addmm"] -= f_dup
    groups = [{"ops": ["aten.convolution"], "prims": ["conv2d"]}, {"ops": ["aten.addmm", "aten.mm"], "prims": ["linear", "adaln_zero"]},
              {"ops": ["aten.baddbmm", "aten.bmm"], "prims": ["attention_scores", "attention_weighted_sum"]}]
    oc = []
    if config_id == "dit-xl2-256":
        for ov, c2 in (({"res": 1024}, dict(c, res=1024)), ({"patch": 4}, dict(c, patch_size=4))):
            m2, _ = dit_model(c2)
            f2, _, bm2, _ = dit_forward(m2, c2)
            _, pd2, fd2, _ = dup_embedders(m2, c2, bm2)
            oc.append({"calc_overrides": ov, "params_total": n_params(m2) - pd2, "flops_total": f2 - fd2})
    # VAE (sd-vae-ft-ema / -mse: la arquitectura del VAE de SD) a la resolución de la config, para las métricas
    vae = eager(meta(lambda: AutoencoderKL(**SD_VAE)))
    fd = sd_decode(vae, c["res"])[0]
    fe = sd_encode(vae, c["res"])[0]
    mc = {"ditParams": params_total, "ditMacs": flops // 2, "diffusersParams": params_raw, "diffusersMacs": flops_raw // 2,
          "officialParams": params_total + pos_buffer, "embedderParams": p_one, "tEmbedMacs": f_emb // 2,
          "vaeDecoderMacs": fd // 2, "vaeEncoderMacs": fe // 2, "vaeDecoderParams": n_params(vae.decoder) + n_params(vae.post_quant_conv), "latentTokens": N}
    gfl = {"dit-xl2-256": 118.6}.get(config_id)
    notes = [
        f"diffusers DiTTransformer2DModel construido en código en el dispositivo meta (sin pesos ni hub; config de {c['hf'] or 'DiT-' + ('XL' if L == 28 else 'B') + '/' + str(P) + ' (Peebles & Xie 2023, Tabla 1)'}): "
        f"latente {lat}×{lat}×4, patch {P} → N = {N} tokens de D = {D}, {L} bloques, out_channels {oc_}.",
        f"diffusers DUPLICA el embedder de tiempo y clase en cada bloque (AdaLayerNormZero.emb = CombinedTimestepLabelEmbeddings, {p_one:,} parámetros) y lo corre {L + 1} veces "
        f"(una por bloque + la capa final, que usa el del bloque 0). El modelo oficial (facebookresearch/DiT, models.py) tiene UN t_embedder y UN y_embedder: "
        f"params_total = {params_raw:,} (diffusers) − {L - 1}·{p_one:,} = {params_total:,}; flops_total = {flops_raw:,} − {f_dup:,} (las {L} llamadas extra, medidas por módulo) = {flops:,}.",
        f"Posición sin/cos 2-D: buffer en diffusers (y en el calculador); el oficial la guarda como nn.Parameter(requires_grad=False) de N·D = {pos_buffer:,} valores, así que su conteo "
        f"sum(p.numel()) da {params_total + pos_buffer:,} (metrics_checks.officialParams)" + (" — los «675M» del paper." if config_id == "dit-xl2-256" else "."),
        "Timesteps de diffusers en DiT usa downscale_freq_shift = 1 (frecuencias exp(−ln 10⁴·i/(127))); el oficial divide por 128: cambia los valores del embedding sinusoidal, no parámetros ni FLOPs.",
        "Atención eager (AttnProcessor: baddbmm + softmax + bmm). diffusers separa to_q/to_k/to_v (con sesgo); el oficial (timm Attention) usa un qkv fusionado: mismos parámetros y MACs (el calculador sigue al oficial: op qkv).",
        "LayerNorm sin parámetros (elementwise_affine = False): γ y β los pone adaLN-Zero (Linear D → 6D por bloque, inicializado en ceros).",
    ]
    if gfl:
        notes.append(f"Paper (Tabla 4): {gfl} «Gflops» para DiT-XL/2 a 256. FlopCounterMode da {flops:,} FLOPs = {flops / 2e9:.2f} GMACs: los «Gflops» del paper son MACs "
                     "(como la tabla de fvcore / DeiT / Swin), la mitad de los FLOPs reales.")
    if oc_ == 4:
        notes.append("Config de flow matching: el mismo DiT-XL/2 con out_channels = 4 (predice la velocidad v, sin Σ): el Linear final es D → P²·4. La interpolación x_t = (1 − t)x₀ + tε, el objetivo v = ε − x₀ y la MSE son elementwise (0 FLOPs).")
    data = {
        "config_id": config_id, "model": "dit", "res": c["res"], "latent": [lat, lat, 4], "N": N,
        "params_total": params_total, "params_total_diffusers_raw": params_raw, "params_duplicated_embedders": p_dup, "pos_embed_values": pos_buffer,
        "params_by_node": pb, "params_by_path": pbp, "shapes": shapes,
        "flops_total": flops, "flops_total_diffusers_raw": flops_raw, "flops_duplicated_embedders": f_dup,
        "flops_by_node": fbn, "flops_by_op_torch": by_op_official, "flops_by_op_torch_raw": by_op, "flops_by_op_groups": groups,
        "override_checks": oc, "metrics_checks": mc,
        "not_hooked": {"beta1…alpha2": "AdaLayerNormZero calcula el Linear D → 6D y lo parte con chunk (se verifica su forma 6D en params)",
                       "q, k, v": "diffusers separa to_q/to_k/to_v; el calculador sigue al qkv fusionado del oficial"},
        "hf_config_source": c["hf"],
        "source": {"lib": "diffusers", "version": diffusers.__version__, "ctor": "with torch.device('meta'): DiTTransformer2DModel(" + ", ".join(f"{k}={v!r}" for k, v in kw.items()) + ")",
                   "reference_architecture": "facebookresearch/DiT models.py (oficial) = diffusers − embedders duplicados", "versions": lib_versions()},
        "notes": notes,
    }
    if gfl:
        data["paper_gflops"] = gfl
    write_expected(config_id, data)


if __name__ == "__main__":
    for cid, train in (("sd15-unet", False), ("sd15-train", True)):
        print(f"▸ {cid}", flush=True)
        run_sd(cid, train)
    print("▸ sdxl-unet", flush=True)
    run_sdxl("sdxl-unet")
    for cid in DIT:
        print(f"▸ {cid}", flush=True)
        run_dit(cid)
