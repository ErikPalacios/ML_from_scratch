"""Cross-check de la fase 15 (SPEC §27): RL con PPO e imitation learning (ACT, Diffusion Policy, BC). Solo desarrollo; no descarga
pesos ni datos (todo se construye en código; los repos oficiales NO son paquetes instalables, así que sus módulos van transcritos
abajo, línea a línea, con la ruta del archivo de origen en cada clase).

RL (modelo `rl-ppo`):
- ppo-mujoco: CleanRL cleanrl/ppo_continuous_action.py (vwxyzjn/cleanrl fe8d8a0), Agent con obs 17 y acción 6 (HalfCheetah-v4 de
  gymnasium 1.4.0 + mujoco 3.15.0: las dimensiones se LEEN del entorno real).
- ppo-atari: CleanRL cleanrl/ppo_atari.py, Nature-CNN compartida, |A| = 4 (BreakoutNoFrameskip-v4 de ale-py 0.12.1).
- ppo-anymal-isaac: rsl_rl v1.0.2 (leggedrobotics/rsl_rl, la versión que pide legged_gym) ActorCritic + RolloutStorage, con
  num_observations 235, num_actions 12, [512, 256, 128] ELU de legged_gym legged_robot_config.py (Isaac Gym no es necesario).
- Para cada config: parámetros por módulo, formas con hooks, FLOPs de un paso (actor + crítico sobre UNA observación) y una
  ITERACIÓN real de PPO bajo FlopCounterMode (los mismos llamados de red que el código oficial: el rollout con no_grad, el
  bootstrap del crítico y K épocas × minibatches de forward + loss.backward()) → metrics_checks rolloutMacs / updateMacs /
  trainMacsPerSample / rolloutBufferBytes (bytes reales de los buffers del código oficial).
- rl_checks: GAE (bucle de CleanRL en torch float64) y la pérdida recortada / del valor / normalización de ventajas, contra una
  referencia en numpy escrita desde las fórmulas del paper (GAE: suma explícita Σ (γλ)^l δ_{t+l} cortada en los fines de episodio),
  y los valores se guardan para compararlos con ATLAS.Arch.robotlearn (tolerancia 1e-9).
Imitation (modelo `imitation`):
- act-aloha / act-aloha-train: tonyzhaozh/act (742c753) detr/models/{detr_vae.py, transformer.py, backbone.py,
  position_encoding.py} transcritos; torchvision resnet18 con FrozenBatchNorm2d; forward de inferencia (actions = None) y de
  entrenamiento (con el chunk de acciones: corre el encoder CVAE). 4 cámaras 480×640, k = 100.
- diffusion-policy-cnn / -transformer: real-stanford/diffusion_policy (5ba07ac) model/diffusion/{conditional_unet1d.py,
  conv1d_components.py, positional_embedding.py, transformer_for_diffusion.py} transcritos (einops reemplazado por
  transpose / unsqueeze equivalentes); encoder de observación de robomimic 0.2.0 (models/base_nets.py ResNet18Conv,
  SpatialSoftmax, VisualCore; models/obs_nets.py ObservationEncoder con ReLU) con BatchNorm → GroupNorm(C/16, C) como
  diffusion_unet_hybrid_image_policy.py; una inferencia = encoder sobre T_o pasos × 2 cámaras + num_inference_steps pasadas
  de la red de ruido con los timesteps de diffusers DDIMScheduler (0.41.0).
- bc-mlp: CNNMLP de tonyzhaozh/act detr/models/detr_vae.py (un backbone por cámara).
Todas las redes de imitation corren en CPU con entradas en cero (eval, sin gradiente): FlopCounterMode cuenta convs, linear,
bmm / sdpa y conv_transpose; las normas, activaciones y softmax no.
"""
import math
import os
import sys

import numpy as np

from common import CUSTOM, n_params, versions, write_expected

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision
from torch.distributions.categorical import Categorical
from torch.distributions.normal import Normal
from torch.utils.flop_counter import FlopCounterMode

torch.manual_seed(0)


def vers():
    import importlib.metadata as md
    v = versions()
    for lib in ("torchvision", "gymnasium", "mujoco", "ale-py", "diffusers", "numpy"):
        try:
            v[lib] = md.version(lib)
        except md.PackageNotFoundError:
            v[lib] = None
    return v


def flops_of(fn):
    fcm = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with fcm:
        fn()
    return int(fcm.get_total_flops()), {str(k): int(v) for k, v in fcm.get_flop_counts().get("Global", {}).items()}


class Hooks:
    """Forma de salida de módulos por nombre (sin convertir: cada config decide cómo pasar a la convención del calculador)."""

    def __init__(self, model, names):
        mods = dict(model.named_modules())
        self.raw, self.h = {}, []
        for tid, name in names.items():
            if name not in mods:
                raise KeyError(f"módulo '{name}' no existe (tensor {tid})")

            def hook(m, i, o, tid=tid):
                t = o[0] if isinstance(o, tuple) else o
                self.raw.setdefault(tid, list(t.shape))
            self.h.append(mods[name].register_forward_hook(hook))

    def remove(self):
        for x in self.h:
            x.remove()


def nchw(s):
    """[B, C, H, W] → [H, W, C] (B = 1)."""
    assert s[0] == 1, s
    return [s[2], s[3], s[1]]


def nct(s):
    """Conv1d [B, C, T] → [T, C]."""
    assert s[0] == 1, s
    return [s[2], s[1]]


def nobatch(s):
    assert s[0] == 1, s
    return s[1:]


# ================================================================== RL: redes de las implementaciones oficiales
class CleanRLContinuous(nn.Module):
    """cleanrl/ppo_continuous_action.py, class Agent (layer_init solo cambia la inicialización)."""

    def __init__(self, obs, act):
        super().__init__()
        self.critic = nn.Sequential(nn.Linear(obs, 64), nn.Tanh(), nn.Linear(64, 64), nn.Tanh(), nn.Linear(64, 1))
        self.actor_mean = nn.Sequential(nn.Linear(obs, 64), nn.Tanh(), nn.Linear(64, 64), nn.Tanh(), nn.Linear(64, act))
        self.actor_logstd = nn.Parameter(torch.zeros(1, act))

    def get_value(self, x):
        return self.critic(x)

    def get_action_and_value(self, x, action=None):
        action_mean = self.actor_mean(x)
        action_logstd = self.actor_logstd.expand_as(action_mean)
        action_std = torch.exp(action_logstd)
        probs = Normal(action_mean, action_std)
        if action is None:
            action = probs.sample()
        return action, probs.log_prob(action).sum(1), probs.entropy().sum(1), self.critic(x)


class CleanRLAtari(nn.Module):
    """cleanrl/ppo_atari.py, class Agent (Nature-CNN compartida)."""

    def __init__(self, n_actions):
        super().__init__()
        self.network = nn.Sequential(
            nn.Conv2d(4, 32, 8, stride=4), nn.ReLU(), nn.Conv2d(32, 64, 4, stride=2), nn.ReLU(), nn.Conv2d(64, 64, 3, stride=1), nn.ReLU(),
            nn.Flatten(), nn.Linear(64 * 7 * 7, 512), nn.ReLU())
        self.actor = nn.Linear(512, n_actions)
        self.critic = nn.Linear(512, 1)

    def get_value(self, x):
        return self.critic(self.network(x / 255.0))

    def get_action_and_value(self, x, action=None):
        hidden = self.network(x / 255.0)
        logits = self.actor(hidden)
        probs = Categorical(logits=logits)
        if action is None:
            action = probs.sample()
        return action, probs.log_prob(action), probs.entropy(), self.critic(hidden)


class RslActorCritic(nn.Module):
    """rsl_rl v1.0.2 rsl_rl/modules/actor_critic.py, class ActorCritic (activación ELU, std aprendida)."""

    def __init__(self, num_actor_obs, num_critic_obs, num_actions, actor_hidden_dims, critic_hidden_dims, init_noise_std=1.0):
        super().__init__()
        activation = nn.ELU()
        actor_layers = [nn.Linear(num_actor_obs, actor_hidden_dims[0]), activation]
        for l in range(len(actor_hidden_dims)):
            if l == len(actor_hidden_dims) - 1:
                actor_layers.append(nn.Linear(actor_hidden_dims[l], num_actions))
            else:
                actor_layers.append(nn.Linear(actor_hidden_dims[l], actor_hidden_dims[l + 1]))
                actor_layers.append(activation)
        self.actor = nn.Sequential(*actor_layers)
        critic_layers = [nn.Linear(num_critic_obs, critic_hidden_dims[0]), activation]
        for l in range(len(critic_hidden_dims)):
            if l == len(critic_hidden_dims) - 1:
                critic_layers.append(nn.Linear(critic_hidden_dims[l], 1))
            else:
                critic_layers.append(nn.Linear(critic_hidden_dims[l], critic_hidden_dims[l + 1]))
                critic_layers.append(activation)
        self.critic = nn.Sequential(*critic_layers)
        self.std = nn.Parameter(init_noise_std * torch.ones(num_actions))
        self.distribution = None

    def update_distribution(self, observations):
        mean = self.actor(observations)
        self.distribution = Normal(mean, mean * 0. + self.std)

    def act(self, observations):
        self.update_distribution(observations)
        return self.distribution.sample()

    def get_actions_log_prob(self, actions):
        return self.distribution.log_prob(actions).sum(dim=-1)

    def evaluate(self, critic_observations):
        return self.critic(critic_observations)

    @property
    def action_mean(self):
        return self.distribution.mean

    @property
    def action_std(self):
        return self.distribution.stddev

    @property
    def entropy(self):
        return self.distribution.entropy().sum(dim=-1)


def env_dims():
    """Dimensiones leídas de los entornos reales (gymnasium + mujoco, ale-py)."""
    import warnings
    warnings.filterwarnings("ignore")
    import gymnasium as gym
    out = {}
    env = gym.make("HalfCheetah-v4")
    out["HalfCheetah-v4"] = {"obs": list(env.observation_space.shape), "act": list(env.action_space.shape), "dt": float(env.unwrapped.dt)}
    try:
        import ale_py
        gym.register_envs(ale_py)
        env = gym.make("BreakoutNoFrameskip-v4")
        out["BreakoutNoFrameskip-v4"] = {"actions": int(env.action_space.n), "meanings": env.unwrapped.get_action_meanings()}
    except Exception as e:  # noqa: BLE001
        out["BreakoutNoFrameskip-v4"] = {"actions": 4, "error": repr(e)}
    return out


# ---------------------------------------------------------------- una iteración de PPO (llamados de red del código oficial)
def cleanrl_iteration(agent, cont, N, T, obs_shape, act_shape, epochs, n_mb, clip, vf, ent):
    """Los llamados de ppo_continuous_action.py / ppo_atari.py SIN el entorno: rollout (no_grad), bootstrap, GAE, K épocas."""
    obs = torch.zeros((T, N) + obs_shape)
    actions = torch.zeros((T, N) + act_shape)
    logprobs = torch.zeros((T, N))
    rewards = torch.zeros((T, N))
    dones = torch.zeros((T, N))
    values = torch.zeros((T, N))
    next_obs = torch.zeros((N,) + obs_shape)
    next_done = torch.zeros(N)
    buf_bytes = sum(int(x.numel() * x.element_size()) for x in (obs, actions, logprobs, rewards, dones, values))

    def rollout():
        with torch.no_grad():
            for step in range(T):
                obs[step] = next_obs
                dones[step] = next_done
                action, logprob, _, value = agent.get_action_and_value(next_obs)
                values[step] = value.flatten()
                actions[step] = action
                logprobs[step] = logprob
            next_value = agent.get_value(next_obs).reshape(1, -1)
        return next_value
    store = {}
    r_flops, _ = flops_of(lambda: store.__setitem__("nv", rollout()))
    with torch.no_grad():
        advantages = torch.zeros_like(rewards)
        lastgaelam = 0
        for t in reversed(range(T)):
            if t == T - 1:
                nextnonterminal = 1.0 - next_done
                nextvalues = store["nv"]
            else:
                nextnonterminal = 1.0 - dones[t + 1]
                nextvalues = values[t + 1]
            delta = rewards[t] + 0.99 * nextvalues * nextnonterminal - values[t]
            advantages[t] = lastgaelam = delta + 0.99 * 0.95 * nextnonterminal * lastgaelam
        returns = advantages + values
    buf_bytes += int(advantages.numel() * advantages.element_size()) + int(returns.numel() * returns.element_size())
    b_obs = obs.reshape((-1,) + obs_shape)
    b_logprobs = logprobs.reshape(-1)
    b_actions = actions.reshape((-1,) + act_shape)
    b_advantages = advantages.reshape(-1)
    b_returns = returns.reshape(-1)
    b_values = values.reshape(-1)
    B = N * T
    mb = B // n_mb
    opt = torch.optim.Adam(agent.parameters(), lr=3e-4, eps=1e-5)

    def update():
        b_inds = np.arange(B)
        for epoch in range(epochs):
            np.random.shuffle(b_inds)
            for start in range(0, B, mb):
                mb_inds = b_inds[start:start + mb]
                _, newlogprob, entropy, newvalue = agent.get_action_and_value(b_obs[mb_inds], b_actions.long()[mb_inds] if not cont else b_actions[mb_inds])
                logratio = newlogprob - b_logprobs[mb_inds]
                ratio = logratio.exp()
                mb_advantages = b_advantages[mb_inds]
                mb_advantages = (mb_advantages - mb_advantages.mean()) / (mb_advantages.std() + 1e-8)
                pg_loss1 = -mb_advantages * ratio
                pg_loss2 = -mb_advantages * torch.clamp(ratio, 1 - clip, 1 + clip)
                pg_loss = torch.max(pg_loss1, pg_loss2).mean()
                newvalue = newvalue.view(-1)
                v_loss_unclipped = (newvalue - b_returns[mb_inds]) ** 2
                v_clipped = b_values[mb_inds] + torch.clamp(newvalue - b_values[mb_inds], -clip, clip)
                v_loss_clipped = (v_clipped - b_returns[mb_inds]) ** 2
                v_loss = 0.5 * torch.max(v_loss_unclipped, v_loss_clipped).mean()
                loss = pg_loss - ent * entropy.mean() + v_loss * vf
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(agent.parameters(), 0.5)
                opt.step()
    u_flops, u_by = flops_of(update)
    return r_flops, u_flops, buf_bytes, u_by


def rsl_iteration(ac, N, T, n_obs, n_act, epochs, n_mb, clip, vf, ent):
    """rsl_rl v1.0.2: PPO.act / process_env_step / compute_returns / update (algorithms/ppo.py, storage/rollout_storage.py)."""
    st = {
        "observations": torch.zeros(T, N, n_obs), "rewards": torch.zeros(T, N, 1), "actions": torch.zeros(T, N, n_act),
        "dones": torch.zeros(T, N, 1).byte(), "actions_log_prob": torch.zeros(T, N, 1), "values": torch.zeros(T, N, 1),
        "returns": torch.zeros(T, N, 1), "advantages": torch.zeros(T, N, 1), "mu": torch.zeros(T, N, n_act), "sigma": torch.zeros(T, N, n_act),
    }
    buf_bytes = sum(int(x.numel() * x.element_size()) for x in st.values())
    obs = torch.zeros(N, n_obs)

    def rollout():
        with torch.no_grad():
            for step in range(T):
                a = ac.act(obs).detach()
                v = ac.evaluate(obs).detach()
                lp = ac.get_actions_log_prob(a).detach()
                st["observations"][step].copy_(obs)
                st["actions"][step].copy_(a)
                st["values"][step].copy_(v)
                st["actions_log_prob"][step].copy_(lp.view(-1, 1))
                st["mu"][step].copy_(ac.action_mean.detach())
                st["sigma"][step].copy_(ac.action_std.detach())
            return ac.evaluate(obs).detach()
    keep = {}
    r_flops, _ = flops_of(lambda: keep.__setitem__("last", rollout()))
    # compute_returns (rollout_storage.py)
    advantage = 0
    for step in reversed(range(T)):
        next_values = keep["last"] if step == T - 1 else st["values"][step + 1]
        nnt = 1.0 - st["dones"][step].float()
        delta = st["rewards"][step] + nnt * 0.99 * next_values - st["values"][step]
        advantage = delta + nnt * 0.99 * 0.95 * advantage
        st["returns"][step] = advantage + st["values"][step]
    st["advantages"] = st["returns"] - st["values"]
    st["advantages"] = (st["advantages"] - st["advantages"].mean()) / (st["advantages"].std() + 1e-8)
    B = N * T
    mb = B // n_mb
    flat = {k: v.flatten(0, 1) for k, v in st.items()}
    opt = torch.optim.Adam(ac.parameters(), lr=1e-3)

    def update():
        for epoch in range(epochs):
            indices = torch.randperm(n_mb * mb, requires_grad=False)
            for i in range(n_mb):
                idx = indices[i * mb:(i + 1) * mb]
                obs_b, act_b = flat["observations"][idx], flat["actions"][idx]
                tv_b, adv_b, ret_b = flat["values"][idx], flat["advantages"][idx], flat["returns"][idx]
                old_lp, old_mu, old_sigma = flat["actions_log_prob"][idx], flat["mu"][idx], flat["sigma"][idx]
                ac.act(obs_b)
                lp = ac.get_actions_log_prob(act_b)
                value_b = ac.evaluate(obs_b)
                mu_b, sigma_b, ent_b = ac.action_mean, ac.action_std, ac.entropy
                with torch.inference_mode():
                    kl = torch.sum(torch.log(sigma_b / old_sigma + 1.e-5) + (torch.square(old_sigma) + torch.square(old_mu - mu_b)) / (2.0 * torch.square(sigma_b)) - 0.5, axis=-1)
                    kl.mean()
                ratio = torch.exp(lp - torch.squeeze(old_lp))
                surrogate = -torch.squeeze(adv_b) * ratio
                surrogate_clipped = -torch.squeeze(adv_b) * torch.clamp(ratio, 1.0 - clip, 1.0 + clip)
                surrogate_loss = torch.max(surrogate, surrogate_clipped).mean()
                value_clipped = tv_b + (value_b - tv_b).clamp(-clip, clip)
                value_loss = torch.max((value_b - ret_b).pow(2), (value_clipped - ret_b).pow(2)).mean()
                loss = surrogate_loss + vf * value_loss - ent * ent_b.mean()
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(ac.parameters(), 1.0)
                opt.step()
    u_flops, u_by = flops_of(update)
    return r_flops, u_flops, buf_bytes, u_by


# ---------------------------------------------------------------- GAE y pérdidas: torch (código oficial) vs numpy (fórmulas)
def gae_numpy(rewards, values, dones, last_value, last_done, gamma, lam):
    """Referencia independiente: Â_t = Σ_{l ≥ 0} (γλ)^l δ_{t+l}, cortando en el primer fin de episodio (convención de CleanRL:
    dones[t] = 1 si el episodio terminó al LLEGAR a t; nonterminal(t) = 1 − dones[t + 1], y 1 − last_done en t = T − 1)."""
    T, N = rewards.shape
    nonterm = np.vstack([1.0 - dones[1:], (1.0 - last_done)[None, :]])
    nextv = np.vstack([values[1:], last_value[None, :]])
    delta = rewards + gamma * nextv * nonterm - values
    adv = np.zeros_like(rewards)
    for t in range(T):
        for i in range(N):
            acc, w = 0.0, 1.0
            for l in range(t, T):
                acc += w * delta[l, i]
                if nonterm[l, i] == 0:
                    break
                w *= gamma * lam
            adv[t, i] = acc
    return adv, adv + values


def gae_torch(rewards, values, dones, last_value, last_done, gamma, lam):
    """El bucle de CleanRL (ppo_continuous_action.py) en float64."""
    rewards, values, dones = (torch.tensor(x, dtype=torch.float64) for x in (rewards, values, dones))
    next_value, next_done = torch.tensor(last_value, dtype=torch.float64), torch.tensor(last_done, dtype=torch.float64)
    T = rewards.shape[0]
    advantages = torch.zeros_like(rewards)
    lastgaelam = 0
    for t in reversed(range(T)):
        if t == T - 1:
            nextnonterminal = 1.0 - next_done
            nextvalues = next_value
        else:
            nextnonterminal = 1.0 - dones[t + 1]
            nextvalues = values[t + 1]
        delta = rewards[t] + gamma * nextvalues * nextnonterminal - values[t]
        advantages[t] = lastgaelam = delta + gamma * lam * nextnonterminal * lastgaelam
    return advantages.numpy(), (advantages + values).numpy()


def rl_checks():
    rng = np.random.default_rng(15)
    T, N = 12, 3
    rewards = np.round(rng.normal(0, 1, (T, N)), 6)
    values = np.round(rng.normal(0, 1, (T, N)), 6)
    dones = np.zeros((T, N))
    dones[5, 0] = 1.0
    dones[9, 2] = 1.0
    dones[1, 1] = 1.0
    last_value = np.round(rng.normal(0, 1, N), 6)
    last_done = np.array([0.0, 1.0, 0.0])
    out = []
    for gamma, lam in ((0.99, 0.95), (0.99, 0.0), (0.99, 1.0), (0.9, 0.5)):
        a_np, r_np = gae_numpy(rewards, values, dones, last_value, last_done, gamma, lam)
        a_t, r_t = gae_torch(rewards, values, dones, last_value, last_done, gamma, lam)
        assert np.allclose(a_np, a_t, atol=1e-12, rtol=0) and np.allclose(r_np, r_t, atol=1e-12, rtol=0), "GAE numpy ≠ torch"
        out.append({"fn": "gae", "what": f"GAE γ = {gamma}, λ = {lam} (T = {T}, N = {N}, 3 fines de episodio)",
                    "args": [rewards.tolist(), values.tolist(), dones.tolist(), last_value.tolist(), last_done.tolist(), gamma, lam],
                    "out": {"advantages": a_np.tolist(), "returns": r_np.tolist()}})
    # λ = 0 es el TD de un paso (δ_t) y λ = 1 el retorno de Monte Carlo menos V (sin descuento de λ): se verifica en numpy.
    a0, _ = gae_numpy(rewards, values, dones, last_value, last_done, 0.99, 0.0)
    nonterm = np.vstack([1.0 - dones[1:], (1.0 - last_done)[None, :]])
    nextv = np.vstack([values[1:], last_value[None, :]])
    assert np.allclose(a0, rewards + 0.99 * nextv * nonterm - values)
    # Pérdida recortada de PPO: CleanRL (torch) vs numpy; ratios a ambos lados de la banda y ventajas de los dos signos.
    ratio = np.array([0.5, 0.75, 0.85, 0.95, 1.0, 1.1, 1.19, 1.25, 1.6, 0.79, 1.21, 2.0])
    adv = np.array([1.0, -1.0, 0.5, -0.5, 2.0, -2.0, 1.5, -1.5, 1.0, 1.0, -1.0, -0.3])
    for eps in (0.2, 0.1):
        r_t, a_t = torch.tensor(ratio), torch.tensor(adv)
        per_t = torch.max(-a_t * r_t, -a_t * torch.clamp(r_t, 1 - eps, 1 + eps))
        per_np = np.maximum(-adv * ratio, -adv * np.clip(ratio, 1 - eps, 1 + eps))
        assert np.allclose(per_t.numpy(), per_np, atol=1e-15)
        clip_frac = float(((r_t - 1.0).abs() > eps).double().mean())
        # gradiente nulo: con autograd, d(per)/d(ratio) = 0 exactamente donde gana el término recortado fuera de la banda
        rr = torch.tensor(ratio, requires_grad=True)
        torch.max(-a_t * rr, -a_t * torch.clamp(rr, 1 - eps, 1 + eps)).sum().backward()
        zero = float((rr.grad == 0).double().mean())
        out.append({"fn": "clipObjective", "what": f"surrogate recortado ε = {eps}", "args": [ratio.tolist(), adv.tolist(), eps],
                    "out": {"loss": float(per_np.mean()), "perSample": per_np.tolist(), "clipFrac": clip_frac, "zeroGradFrac": zero}})
    newv = np.array([0.5, 1.2, -0.3, 2.0, 0.0, 0.9])
    oldv = np.array([0.4, 0.8, 0.1, 1.5, 0.3, 1.0])
    ret = np.array([1.0, 1.0, -1.0, 1.0, 0.2, 0.5])
    for half, eps in ((True, 0.2), (False, 0.2)):
        vc = oldv + np.clip(newv - oldv, -eps, eps)
        vl = (0.5 if half else 1.0) * float(np.maximum((newv - ret) ** 2, (vc - ret) ** 2).mean())
        t_nv, t_ov, t_r = (torch.tensor(x) for x in (newv, oldv, ret))
        t_vc = t_ov + torch.clamp(t_nv - t_ov, -eps, eps)
        t_vl = (0.5 if half else 1.0) * torch.max((t_nv - t_r) ** 2, (t_vc - t_r) ** 2).mean()
        assert abs(float(t_vl) - vl) < 1e-15
        out.append({"fn": "valueLoss", "what": "pérdida del valor recortada (" + ("CleanRL, ×0.5" if half else "rsl_rl, sin ½") + ")",
                    "args": [newv.tolist(), oldv.tolist(), ret.tolist(), eps, half], "out": {"value": vl}})
    a = np.array([0.3, -1.2, 2.5, 0.0, 0.7, -0.4])
    t = torch.tensor(a)
    norm = ((t - t.mean()) / (t.std() + 1e-8)).numpy()
    out.append({"fn": "normalizeAdv", "what": "normalización de ventajas (torch.std, n − 1)", "args": [a.tolist()], "out": {"list": norm.tolist()}})
    return out


def rl_config(cid, dims):
    if cid == "ppo-mujoco":
        obs, act = dims["HalfCheetah-v4"]["obs"][0], dims["HalfCheetah-v4"]["act"][0]
        agent = CleanRLContinuous(obs, act)
        names = {"a-h1": "actor_mean.0", "a-z1": "actor_mean.1", "a-h2": "actor_mean.2", "a-z2": "actor_mean.3", "act-mean": "actor_mean.4",
                 "c-h1": "critic.0", "c-z1": "critic.1", "c-h2": "critic.2", "c-z2": "critic.3", "value": "critic.4"}
        x = torch.zeros(1, obs)
        hk = Hooks(agent, names)
        step_flops, by = flops_of(lambda: agent.get_action_and_value(x))
        hk.remove()
        shapes = {"obs": [obs], "act-std": [act], "action": [act], "logp": [1]}
        shapes.update({k: nobatch(v) for k, v in hk.raw.items()})
        pbn = {"actor": n_params(agent.actor_mean) + agent.actor_logstd.numel(), "critic": n_params(agent.critic), "log-std": agent.actor_logstd.numel(),
               "mean": n_params(agent.actor_mean[4]), "fc1": n_params(agent.actor_mean[0]) + n_params(agent.critic[0])}
        N, T, K, nmb = 1, 2048, 10, 32
        rf, uf, bb, uby = cleanrl_iteration(agent, True, N, T, (obs,), (act,), K, nmb, 0.2, 0.5, 0.0)
        src = {"lib": "torch (transcrito de CleanRL cleanrl/ppo_continuous_action.py, fe8d8a0)", "ctor": f"Agent(obs={obs}, act={act}): critic/actor_mean 64-64 tanh + actor_logstd", "env": dims["HalfCheetah-v4"]}
        notes = [f"HalfCheetah-v4 (gymnasium + mujoco): obs {obs}, acción {act}, dt {dims['HalfCheetah-v4']['dt']} s.",
                 "Un paso = get_action_and_value sobre UNA observación: actor_mean + critic (FlopCounterMode: solo los Linear).",
                 "Iteración real: N = 1 × T = 2048 con no_grad + get_value del bootstrap; 10 épocas × 32 minibatches de 64 con loss.backward(): sin gradiente de la entrada en la 1.ª capa de cada red."]
    elif cid == "ppo-atari":
        nA = dims["BreakoutNoFrameskip-v4"]["actions"]
        agent = CleanRLAtari(nA)
        names = {"t-c1": "network.0", "t-a1": "network.1", "t-c2": "network.2", "t-a2": "network.3", "t-c3": "network.4", "t-a3": "network.5",
                 "t-flat": "network.6", "t-fc": "network.7", "features": "network.8", "act-logits": "actor", "value": "critic"}
        x = torch.zeros(1, 4, 84, 84)
        hk = Hooks(agent, names)
        step_flops, by = flops_of(lambda: agent.get_action_and_value(x))
        hk.remove()
        shapes = {"obs": [84, 84, 4], "action": [1], "logp": [1]}
        for k, v in hk.raw.items():
            shapes[k] = nchw(v) if len(v) == 4 else nobatch(v)
        pbn = {"trunk": n_params(agent.network), "actor": n_params(agent.actor), "critic": n_params(agent.critic), "conv1": n_params(agent.network[0]), "fc": n_params(agent.network[7])}
        N, T, K, nmb = 8, 128, 3, 4
        rf, uf, bb, uby = cleanrl_iteration(agent, False, N, T, (4, 84, 84), (), K, nmb, 0.1, 1.0, 0.01)
        src = {"lib": "torch (transcrito de CleanRL cleanrl/ppo_atari.py, fe8d8a0)", "ctor": f"Agent: Nature-CNN + actor 512 → {nA} + critic 512 → 1", "env": dims["BreakoutNoFrameskip-v4"]}
        notes = ["Nature-CNN compartida: el tronco corre una vez por paso y alimenta al actor y al crítico.",
                 "Iteración real con los hiperparámetros de la Tabla 5 del paper (8 × 128, 3 épocas, 4 minibatches de 256; CleanRL usa 4 épocas por defecto).",
                 "obs se guarda en float32 en el buffer de CleanRL (4×84×84 por paso): domina los bytes del rollout."]
    else:
        n_obs, n_act = 235, 12
        ac = RslActorCritic(n_obs, n_obs, n_act, [512, 256, 128], [512, 256, 128])
        names = {"a-h1": "actor.0", "a-z1": "actor.1", "a-h2": "actor.2", "a-z2": "actor.3", "a-h3": "actor.4", "a-z3": "actor.5", "act-mean": "actor.6",
                 "c-h1": "critic.0", "c-z1": "critic.1", "c-h2": "critic.2", "c-z2": "critic.3", "c-h3": "critic.4", "c-z3": "critic.5", "value": "critic.6"}
        # ELU es UN módulo compartido (activation) en rsl_rl: su hook ve la 1.ª llamada (setdefault); las formas de z2/z3 salen de su Linear.
        x = torch.zeros(1, n_obs)
        hk = Hooks(ac, {k: v for k, v in names.items() if not k.endswith(("z1", "z2", "z3"))})

        def step():
            ac.act(x)
            ac.evaluate(x)
        step_flops, by = flops_of(step)
        hk.remove()
        shapes = {"obs": [n_obs], "act-std": [n_act], "action": [n_act], "logp": [1]}
        shapes.update({k: nobatch(v) for k, v in hk.raw.items()})
        for p in ("a", "c"):
            for i in (1, 2, 3):
                shapes[f"{p}-z{i}"] = shapes[f"{p}-h{i}"]
        pbn = {"actor": n_params(ac.actor) + ac.std.numel(), "critic": n_params(ac.critic), "log-std": ac.std.numel(), "fc1": n_params(ac.actor[0]) + n_params(ac.critic[0])}
        N, T, K, nmb = 4096, 24, 5, 4
        rf, uf, bb, uby = rsl_iteration(ac, N, T, n_obs, n_act, K, nmb, 0.2, 1.0, 0.01)
        agent = ac
        src = {"lib": "torch (transcrito de rsl_rl v1.0.2 rsl_rl/modules/actor_critic.py, algorithms/ppo.py, storage/rollout_storage.py)",
               "ctor": "ActorCritic(235, 235, 12, [512, 256, 128], [512, 256, 128], ELU, init_noise_std 1.0)"}
        notes = ["Dimensiones de legged_gym legged_robot_config.py (num_observations 235 = 48 + 187 alturas, num_actions 12); Isaac Gym no hace falta para la red.",
                 "rsl_rl usa UN módulo ELU compartido: las formas de a-z{i} / c-z{i} son las de su Linear.",
                 "Iteración real: 4096 × 24 con no_grad (act + evaluate), evaluate del bootstrap, 5 épocas × 4 minibatches de 24,576 con loss.backward(); el KL del lr adaptativo va en inference_mode (sin MACs)."]
    T_, N_ = (2048, 1) if cid == "ppo-mujoco" else (128, 8) if cid == "ppo-atari" else (24, 4096)
    shapes.update({"rollout": [T_, N_], "advantages": [T_, N_], "returns": [T_, N_], "reward": [1]})
    samples = N * T
    assert uf % (2 * K * samples) == 0, (cid, uf)
    data = {
        "config_id": cid, "model": "rl-ppo",
        "params_total": n_params(agent),
        "params_by_node": pbn,
        "shapes": shapes,
        "flops_total": step_flops,
        "flops_by_op": by,
        "metrics_checks": {"rolloutMacs": rf // 2, "updateMacs": uf // 2, "trainMacsPerSample": uf // (2 * K * samples), "rolloutBufferBytes": bb},
        "update_flops_by_op": uby,
        "source": dict(src, versions=vers()),
        "notes": notes,
    }
    if cid == "ppo-mujoco":
        data["rl_checks"] = rl_checks()
    write_expected(cid, data)
    print(f"  {cid}: params {data['params_total']:,} · paso {step_flops // 2:,} MACs · rollout {rf // 2:,} · update {uf // 2:,} · buffer {bb:,} B", file=sys.stderr)


# ================================================================== imitation: ACT (tonyzhaozh/act, transcrito)
class FrozenBatchNorm2d(nn.Module):
    """detr/models/backbone.py: γ, β, media y varianza = buffers."""

    def __init__(self, n):
        super().__init__()
        self.register_buffer("weight", torch.ones(n))
        self.register_buffer("bias", torch.zeros(n))
        self.register_buffer("running_mean", torch.zeros(n))
        self.register_buffer("running_var", torch.ones(n))

    def forward(self, x):
        w = self.weight.reshape(1, -1, 1, 1)
        b = self.bias.reshape(1, -1, 1, 1)
        rv = self.running_var.reshape(1, -1, 1, 1)
        rm = self.running_mean.reshape(1, -1, 1, 1)
        scale = w * (rv + 1e-5).rsqrt()
        bias = b - rm * scale
        return x * scale + bias


class PositionEmbeddingSine(nn.Module):
    """detr/models/position_encoding.py (normalize = False, como build_position_encoding de ACT)."""

    def __init__(self, num_pos_feats=64, temperature=10000):
        super().__init__()
        self.num_pos_feats, self.temperature = num_pos_feats, temperature

    def forward(self, x):
        not_mask = torch.ones_like(x[0, [0]])
        y_embed = not_mask.cumsum(1, dtype=torch.float32)
        x_embed = not_mask.cumsum(2, dtype=torch.float32)
        dim_t = torch.arange(self.num_pos_feats, dtype=torch.float32, device=x.device)
        dim_t = self.temperature ** (2 * (dim_t // 2) / self.num_pos_feats)
        pos_x = x_embed[:, :, :, None] / dim_t
        pos_y = y_embed[:, :, :, None] / dim_t
        pos_x = torch.stack((pos_x[:, :, :, 0::2].sin(), pos_x[:, :, :, 1::2].cos()), dim=4).flatten(3)
        pos_y = torch.stack((pos_y[:, :, :, 0::2].sin(), pos_y[:, :, :, 1::2].cos()), dim=4).flatten(3)
        return torch.cat((pos_y, pos_x), dim=3).permute(0, 3, 1, 2)


class Joiner(nn.Module):
    """detr/models/backbone.py Backbone (IntermediateLayerGetter hasta layer4) + Joiner (PE)."""

    def __init__(self, hidden_dim):
        super().__init__()
        r = torchvision.models.resnet18(weights=None, norm_layer=FrozenBatchNorm2d)
        self.body = torchvision.models._utils.IntermediateLayerGetter(r, return_layers={"layer4": "0"})
        self.pos = PositionEmbeddingSine(hidden_dim // 2)
        self.num_channels = 512

    def forward(self, x):
        xs = self.body(x)
        out, pos = [], []
        for _, t in xs.items():
            out.append(t)
            pos.append(self.pos(t).to(t.dtype))
        return out, pos


class TransformerEncoderLayer(nn.Module):
    """detr/models/transformer.py (post-LN: normalize_before = False)."""

    def __init__(self, d_model, nhead, dim_feedforward, dropout=0.1):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout)
        self.linear1 = nn.Linear(d_model, dim_feedforward)
        self.dropout = nn.Dropout(dropout)
        self.linear2 = nn.Linear(dim_feedforward, d_model)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.dropout1 = nn.Dropout(dropout)
        self.dropout2 = nn.Dropout(dropout)

    def forward(self, src, src_key_padding_mask=None, pos=None):
        q = k = src if pos is None else src + pos
        src2 = self.self_attn(q, k, value=src, key_padding_mask=src_key_padding_mask)[0]
        src = src + self.dropout1(src2)
        src = self.norm1(src)
        src2 = self.linear2(self.dropout(F.relu(self.linear1(src))))
        src = src + self.dropout2(src2)
        return self.norm2(src)


class TransformerDecoderLayer(nn.Module):
    def __init__(self, d_model, nhead, dim_feedforward, dropout=0.1):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout)
        self.multihead_attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout)
        self.linear1 = nn.Linear(d_model, dim_feedforward)
        self.dropout = nn.Dropout(dropout)
        self.linear2 = nn.Linear(dim_feedforward, d_model)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.norm3 = nn.LayerNorm(d_model)
        self.dropout1 = nn.Dropout(dropout)
        self.dropout2 = nn.Dropout(dropout)
        self.dropout3 = nn.Dropout(dropout)

    def forward(self, tgt, memory, pos=None, query_pos=None):
        q = k = tgt + query_pos
        tgt2 = self.self_attn(q, k, value=tgt)[0]
        tgt = self.norm1(tgt + self.dropout1(tgt2))
        tgt2 = self.multihead_attn(query=tgt + query_pos, key=memory + pos, value=memory)[0]
        tgt = self.norm2(tgt + self.dropout2(tgt2))
        tgt2 = self.linear2(self.dropout(F.relu(self.linear1(tgt))))
        return self.norm3(tgt + self.dropout3(tgt2))


class TransformerEncoder(nn.Module):
    def __init__(self, layer_fn, num_layers):
        super().__init__()
        self.layers = nn.ModuleList([layer_fn() for _ in range(num_layers)])

    def forward(self, src, src_key_padding_mask=None, pos=None):
        out = src
        for layer in self.layers:
            out = layer(out, src_key_padding_mask=src_key_padding_mask, pos=pos)
        return out


class TransformerDecoder(nn.Module):
    """return_intermediate = True (build_transformer de ACT): apila norm(salida) de cada capa."""

    def __init__(self, layer_fn, num_layers, d_model):
        super().__init__()
        self.layers = nn.ModuleList([layer_fn() for _ in range(num_layers)])
        self.norm = nn.LayerNorm(d_model)

    def forward(self, tgt, memory, pos=None, query_pos=None):
        output, intermediate = tgt, []
        for layer in self.layers:
            output = layer(output, memory, pos=pos, query_pos=query_pos)
            intermediate.append(self.norm(output))
        output = self.norm(output)
        intermediate.pop()
        intermediate.append(output)
        return torch.stack(intermediate)


class Transformer(nn.Module):
    def __init__(self, d_model, nhead, enc, dec, ff):
        super().__init__()
        self.encoder = TransformerEncoder(lambda: TransformerEncoderLayer(d_model, nhead, ff), enc)
        self.decoder = TransformerDecoder(lambda: TransformerDecoderLayer(d_model, nhead, ff), dec, d_model)
        self.d_model = d_model

    def forward(self, src, query_embed, pos_embed, latent_input, proprio_input, additional_pos_embed):
        bs, c, h, w = src.shape
        src = src.flatten(2).permute(2, 0, 1)
        pos_embed = pos_embed.flatten(2).permute(2, 0, 1).repeat(1, bs, 1)
        query_embed = query_embed.unsqueeze(1).repeat(1, bs, 1)
        additional_pos_embed = additional_pos_embed.unsqueeze(1).repeat(1, bs, 1)
        pos_embed = torch.cat([additional_pos_embed, pos_embed], axis=0)
        addition_input = torch.stack([latent_input, proprio_input], axis=0)
        src = torch.cat([addition_input, src], axis=0)
        tgt = torch.zeros_like(query_embed)
        memory = self.encoder(src, pos=pos_embed)
        hs = self.decoder(tgt, memory, pos=pos_embed, query_pos=query_embed)
        return hs.transpose(1, 2)


def sinusoid_table(n_position, d_hid):
    def angle(position):
        return [position / np.power(10000, 2 * (j // 2) / d_hid) for j in range(d_hid)]
    t = np.array([angle(p) for p in range(n_position)])
    t[:, 0::2] = np.sin(t[:, 0::2])
    t[:, 1::2] = np.cos(t[:, 1::2])
    return torch.FloatTensor(t).unsqueeze(0)


class DETRVAE(nn.Module):
    """detr/models/detr_vae.py (con backbone)."""

    def __init__(self, num_queries, cams, hidden=512, nhead=8, enc=4, dec=7, ff=3200, state_dim=14):
        super().__init__()
        self.num_queries, self.cams = num_queries, cams
        self.transformer = Transformer(hidden, nhead, enc, dec, ff)
        self.encoder = TransformerEncoder(lambda: TransformerEncoderLayer(hidden, nhead, ff), enc)
        self.action_head = nn.Linear(hidden, state_dim)
        self.is_pad_head = nn.Linear(hidden, 1)
        self.query_embed = nn.Embedding(num_queries, hidden)
        self.input_proj = nn.Conv2d(512, hidden, kernel_size=1)
        self.backbones = nn.ModuleList([Joiner(hidden)])
        self.input_proj_robot_state = nn.Linear(14, hidden)
        self.latent_dim = 32
        self.cls_embed = nn.Embedding(1, hidden)
        self.encoder_action_proj = nn.Linear(14, hidden)
        self.encoder_joint_proj = nn.Linear(14, hidden)
        self.latent_proj = nn.Linear(hidden, self.latent_dim * 2)
        self.register_buffer("pos_table", sinusoid_table(1 + 1 + num_queries, hidden))
        self.latent_out_proj = nn.Linear(self.latent_dim, hidden)
        self.additional_pos_embed = nn.Embedding(2, hidden)

    def forward(self, qpos, image, actions=None, is_pad=None):
        bs, _ = qpos.shape
        if actions is not None:
            action_embed = self.encoder_action_proj(actions)
            qpos_embed = torch.unsqueeze(self.encoder_joint_proj(qpos), axis=1)
            cls_embed = torch.unsqueeze(self.cls_embed.weight, axis=0).repeat(bs, 1, 1)
            encoder_input = torch.cat([cls_embed, qpos_embed, action_embed], axis=1).permute(1, 0, 2)
            cls_joint_is_pad = torch.full((bs, 2), False).to(qpos.device)
            is_pad = torch.cat([cls_joint_is_pad, is_pad], axis=1)
            pos_embed = self.pos_table.clone().detach().permute(1, 0, 2)
            encoder_output = self.encoder(encoder_input, pos=pos_embed, src_key_padding_mask=is_pad)[0]
            latent_info = self.latent_proj(encoder_output)
            mu, logvar = latent_info[:, :self.latent_dim], latent_info[:, self.latent_dim:]
            std = logvar.div(2).exp()
            latent_sample = mu + std * torch.randn_like(std)
            latent_input = self.latent_out_proj(latent_sample)
        else:
            mu = logvar = None
            latent_sample = torch.zeros([bs, self.latent_dim], dtype=torch.float32).to(qpos.device)
            latent_input = self.latent_out_proj(latent_sample)
        all_cam_features, all_cam_pos = [], []
        for cam_id in range(self.cams):
            features, pos = self.backbones[0](image[:, cam_id])  # HARDCODED (un backbone para todas las cámaras)
            all_cam_features.append(self.input_proj(features[0]))
            all_cam_pos.append(pos[0])
        proprio_input = self.input_proj_robot_state(qpos)
        src = torch.cat(all_cam_features, axis=3)
        pos = torch.cat(all_cam_pos, axis=3)
        hs = self.transformer(src, self.query_embed.weight, pos, latent_input, proprio_input, self.additional_pos_embed.weight)[0]
        return self.action_head(hs), self.is_pad_head(hs), [mu, logvar]


def act_config(cid, train):
    cams, k, H, W = 4, 100, 480, 640
    m = DETRVAE(k, cams).eval()
    names = {"c2": "backbones.0.body.layer1", "c3": "backbones.0.body.layer2", "c4": "backbones.0.body.layer3", "c5": "backbones.0.body.layer4",
             "bb-stem-conv": "backbones.0.body.conv1", "bb-pool": "backbones.0.body.maxpool", "feat": "input_proj",
             "proprio-tok": "input_proj_robot_state", "latent-tok": "latent_out_proj", "memory": "transformer.encoder.layers.3",
             "d-out": "transformer.decoder.layers.6", "hs": "transformer.decoder.norm", "actions": "action_head", "is-pad": "is_pad_head",
             "e-u": "transformer.encoder.layers.0.linear1", "d-u": "transformer.decoder.layers.0.linear1"}
    if train:
        names.update({"cvae-action-tok": "encoder_action_proj", "cvae-qpos-tok": "encoder_joint_proj", "latent-info": "latent_proj", "cvae-out": "encoder.layers.3"})
    hk = Hooks(m, names)
    qpos, image = torch.zeros(1, 14), torch.zeros(1, cams, 3, H, W)
    if train:
        actions, is_pad = torch.zeros(1, k, 14), torch.zeros(1, k, dtype=torch.bool)
        with torch.no_grad():
            fl, by = flops_of(lambda: m(qpos, image, actions, is_pad))
    else:
        with torch.no_grad():
            fl, by = flops_of(lambda: m(qpos, image))
    hk.remove()
    raw = hk.raw
    shapes = {"img": [H, W, 3], "qpos": [14], "z": [32], "src": [cams * 15 * 20 + 2, 512], "img-tokens": [cams * 300, 512],
              "query-pos": [k, 512], "tgt0": [k, 512], "extra-pos": [2, 512]}
    for tid in ("c2", "c3", "c4", "c5", "bb-stem-conv", "bb-pool", "feat"):
        shapes[tid] = nchw(raw[tid])
    for tid in ("proprio-tok", "latent-tok", "actions", "is-pad"):
        shapes[tid] = nobatch(raw[tid])
    for tid in ("memory", "d-out", "hs", "e-u", "d-u"):   # secuencia primero: [L, B, D]
        s = raw[tid]
        assert s[1] == 1, (tid, s)
        shapes[tid] = [s[0], s[2]]
    if train:
        shapes["action-seq"] = [k, 14]
        shapes["cvae-action-tok"] = nobatch(raw["cvae-action-tok"])
        shapes["cvae-qpos-tok"] = nobatch(raw["cvae-qpos-tok"])
        shapes["latent-info"] = nobatch(raw["latent-info"])
        s = raw["cvae-out"]
        shapes["cvae-out"] = [s[0], s[2]]
        shapes["mu"], shapes["logvar"] = [32], [32]
    cvae = n_params(m.encoder) + n_params(m.cls_embed) + n_params(m.encoder_action_proj) + n_params(m.encoder_joint_proj) + n_params(m.latent_proj)
    pbn = {"backbone": n_params(m.backbones), "input-proj": n_params(m.input_proj), "proprio-proj": n_params(m.input_proj_robot_state),
           "latent-proj": n_params(m.latent_out_proj), "extra-pos": n_params(m.additional_pos_embed), "queries": n_params(m.query_embed),
           "encoder": n_params(m.transformer.encoder), "decoder": n_params(m.transformer.decoder.layers), "dec-norm": n_params(m.transformer.decoder.norm),
           "action-head": n_params(m.action_head), "is-pad-head": n_params(m.is_pad_head), "cvae": cvae}
    flops_node = {}
    # FLOPs por bloque: forward parcial del backbone (una cámara) y del decoder
    with torch.no_grad():
        f_bb, _ = flops_of(lambda: m.backbones[0](image[:, 0]))
    flops_node["backbone"] = cams * f_bb
    data = {
        "config_id": cid, "model": "imitation",
        "params_total": n_params(m), "params_by_node": pbn, "shapes": shapes, "flops_total": fl, "flops_by_op": by, "flops_by_node": flops_node,
        "buffers_total": sum(int(b.numel()) for _, b in m.named_buffers()),
        "source": {"lib": "torch + torchvision (transcrito de tonyzhaozh/act 742c753: detr/models/detr_vae.py, transformer.py, backbone.py, position_encoding.py)",
                   "ctor": "DETRVAE(num_queries=100, cams=4, hidden 512, nheads 8, enc 4, dec 7, ff 3200), resnet18(norm_layer=FrozenBatchNorm2d)", "versions": vers()},
        "notes": [
            "UN backbone para las 4 cámaras (self.backbones[0] HARDCODED): sus pesos cuentan una vez y corre 4 veces.",
            "FrozenBatchNorm2d: γ, β, media y varianza son buffers (buffers_total los incluye junto con pos_table); no cuentan como parámetros.",
            "return_intermediate_dec = True y hs = transformer(…)[0]: las cabezas leen la salida (normalizada) de la PRIMERA capa del decoder; las 7 capas corren igual (FlopCounterMode las cuenta).",
            ("Entrenamiento: el encoder CVAE corre sobre [CLS; articulaciones; 100 acciones] = 102 tokens; z = μ + σ·ε." if train else "Inferencia: actions = None → z = 0 y el encoder CVAE no corre (sus parámetros existen)."),
        ],
    }
    write_expected(cid, data)
    print(f"  {cid}: params {data['params_total']:,} · {fl // 2:,} MACs", file=sys.stderr)


# ================================================================== imitation: Diffusion Policy (real-stanford/diffusion_policy + robomimic 0.2.0)
class SinusoidalPosEmb(nn.Module):
    """model/diffusion/positional_embedding.py."""

    def __init__(self, dim):
        super().__init__()
        self.dim = dim

    def forward(self, x):
        half_dim = self.dim // 2
        emb = math.log(10000) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=x.device) * -emb)
        emb = x[:, None] * emb[None, :]
        return torch.cat((emb.sin(), emb.cos()), dim=-1)


class Conv1dBlock(nn.Module):
    """model/diffusion/conv1d_components.py: Conv1d → GroupNorm → Mish."""

    def __init__(self, inp, out, kernel_size, n_groups=8):
        super().__init__()
        self.block = nn.Sequential(nn.Conv1d(inp, out, kernel_size, padding=kernel_size // 2), nn.GroupNorm(n_groups, out), nn.Mish())

    def forward(self, x):
        return self.block(x)


class ConditionalResidualBlock1D(nn.Module):
    """model/diffusion/conditional_unet1d.py (Rearrange('batch t -> batch t 1') = unsqueeze(-1))."""

    def __init__(self, in_channels, out_channels, cond_dim, kernel_size=3, n_groups=8, cond_predict_scale=False):
        super().__init__()
        self.blocks = nn.ModuleList([Conv1dBlock(in_channels, out_channels, kernel_size, n_groups=n_groups),
                                     Conv1dBlock(out_channels, out_channels, kernel_size, n_groups=n_groups)])
        cond_channels = out_channels * 2 if cond_predict_scale else out_channels
        self.cond_predict_scale, self.out_channels = cond_predict_scale, out_channels
        self.cond_encoder = nn.Sequential(nn.Mish(), nn.Linear(cond_dim, cond_channels))
        self.residual_conv = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()

    def forward(self, x, cond):
        out = self.blocks[0](x)
        embed = self.cond_encoder(cond).unsqueeze(-1)
        if self.cond_predict_scale:
            embed = embed.reshape(embed.shape[0], 2, self.out_channels, 1)
            out = embed[:, 0, ...] * out + embed[:, 1, ...]
        else:
            out = out + embed
        out = self.blocks[1](out)
        return out + self.residual_conv(x)


class ConditionalUnet1D(nn.Module):
    def __init__(self, input_dim, global_cond_dim, diffusion_step_embed_dim=256, down_dims=(256, 512, 1024), kernel_size=3, n_groups=8, cond_predict_scale=False):
        super().__init__()
        all_dims = [input_dim] + list(down_dims)
        start_dim = down_dims[0]
        dsed = diffusion_step_embed_dim
        self.diffusion_step_encoder = nn.Sequential(SinusoidalPosEmb(dsed), nn.Linear(dsed, dsed * 4), nn.Mish(), nn.Linear(dsed * 4, dsed))
        cond_dim = dsed + global_cond_dim
        in_out = list(zip(all_dims[:-1], all_dims[1:]))
        mid_dim = all_dims[-1]
        mk = lambda a, b: ConditionalResidualBlock1D(a, b, cond_dim=cond_dim, kernel_size=kernel_size, n_groups=n_groups, cond_predict_scale=cond_predict_scale)  # noqa: E731
        self.mid_modules = nn.ModuleList([mk(mid_dim, mid_dim), mk(mid_dim, mid_dim)])
        self.down_modules = nn.ModuleList([])
        for ind, (dim_in, dim_out) in enumerate(in_out):
            is_last = ind >= (len(in_out) - 1)
            self.down_modules.append(nn.ModuleList([mk(dim_in, dim_out), mk(dim_out, dim_out), nn.Conv1d(dim_out, dim_out, 3, 2, 1) if not is_last else nn.Identity()]))
        self.up_modules = nn.ModuleList([])
        for ind, (dim_in, dim_out) in enumerate(reversed(in_out[1:])):
            is_last = ind >= (len(in_out) - 1)
            self.up_modules.append(nn.ModuleList([mk(dim_out * 2, dim_in), mk(dim_in, dim_in), nn.ConvTranspose1d(dim_in, dim_in, 4, 2, 1) if not is_last else nn.Identity()]))
        self.final_conv = nn.Sequential(Conv1dBlock(start_dim, start_dim, kernel_size=kernel_size), nn.Conv1d(start_dim, input_dim, 1))

    def forward(self, sample, timestep, global_cond):
        sample = sample.transpose(1, 2)   # einops 'b h t -> b t h'
        timesteps = timestep.expand(sample.shape[0])
        global_feature = self.diffusion_step_encoder(timesteps)
        global_feature = torch.cat([global_feature, global_cond], axis=-1)
        x, h = sample, []
        for resnet, resnet2, downsample in self.down_modules:
            x = resnet(x, global_feature)
            x = resnet2(x, global_feature)
            h.append(x)
            x = downsample(x)
        for mid_module in self.mid_modules:
            x = mid_module(x, global_feature)
        for resnet, resnet2, upsample in self.up_modules:
            x = torch.cat((x, h.pop()), dim=1)
            x = resnet(x, global_feature)
            x = resnet2(x, global_feature)
            x = upsample(x)
        x = self.final_conv(x)
        return x.transpose(1, 2)


class SpatialSoftmax(nn.Module):
    """robomimic 0.2.0 models/base_nets.py SpatialSoftmax (num_kp 32, temperature 1 fija = buffer)."""

    def __init__(self, input_shape, num_kp=32):
        super().__init__()
        self._in_c, self._in_h, self._in_w = input_shape
        self.nets = nn.Conv2d(self._in_c, num_kp, kernel_size=1)
        self._num_kp = num_kp
        self.register_buffer("temperature", torch.ones(1))
        pos_x, pos_y = np.meshgrid(np.linspace(-1., 1., self._in_w), np.linspace(-1., 1., self._in_h))
        self.register_buffer("pos_x", torch.from_numpy(pos_x.reshape(1, self._in_h * self._in_w)).float())
        self.register_buffer("pos_y", torch.from_numpy(pos_y.reshape(1, self._in_h * self._in_w)).float())

    def forward(self, feature):
        feature = self.nets(feature)
        feature = feature.reshape(-1, self._in_h * self._in_w)
        attention = F.softmax(feature / self.temperature, dim=-1)
        expected_x = torch.sum(self.pos_x * attention, dim=1, keepdim=True)
        expected_y = torch.sum(self.pos_y * attention, dim=1, keepdim=True)
        return torch.cat([expected_x, expected_y], 1).view(-1, self._num_kp, 2)


class VisualCore(nn.Module):
    """robomimic 0.2.0 models/base_nets.py VisualCore(ResNet18Conv, SpatialSoftmax, flatten, Linear 64 → feature_dimension)."""

    def __init__(self, input_shape, feature_dimension=64):
        super().__init__()
        net = torchvision.models.resnet18(weights=None)
        backbone = nn.Sequential(*(list(net.children())[:-2]))   # ResNet18Conv: sin avgpool ni fc
        oh, ow = int(math.ceil(input_shape[1] / 32.)), int(math.ceil(input_shape[2] / 32.))
        pool = SpatialSoftmax((512, oh, ow), num_kp=32)
        self.nets = nn.Sequential(backbone, pool, nn.Flatten(start_dim=1, end_dim=-1), nn.Linear(64, feature_dimension))

    def forward(self, x):
        return self.nets(x)


def replace_bn_with_gn(module):
    """diffusion_unet_hybrid_image_policy.py: replace_submodules(BatchNorm2d → GroupNorm(num_features // 16, num_features))."""
    for name, child in list(module.named_children()):
        if isinstance(child, nn.BatchNorm2d):
            setattr(module, name, nn.GroupNorm(num_groups=child.num_features // 16, num_channels=child.num_features))
        else:
            replace_bn_with_gn(child)


class ObsEncoder(nn.Module):
    """robomimic ObservationEncoder: un VisualCore por cámara (sin compartir) + ReLU (feature_activation); low-dim sin red."""

    def __init__(self, cams, crop):
        super().__init__()
        self.obs_nets = nn.ModuleList([VisualCore((3,) + tuple(crop)) for _ in range(cams)])
        replace_bn_with_gn(self.obs_nets)
        self.act = nn.ReLU()

    def forward(self, imgs, low):
        feats = [self.act(net(x)) for net, x in zip(self.obs_nets, imgs)]
        return torch.cat(feats + [low], dim=-1)


class TransformerForDiffusion(nn.Module):
    """model/diffusion/transformer_for_diffusion.py (time_as_cond, obs_as_cond, n_cond_layers = 0, causal_attn)."""

    def __init__(self, input_dim, output_dim, horizon, n_obs_steps, cond_dim, n_layer, n_head, n_emb, p_drop_attn=0.3):
        super().__init__()
        T, T_cond = horizon, 1 + n_obs_steps
        self.input_emb = nn.Linear(input_dim, n_emb)
        self.pos_emb = nn.Parameter(torch.zeros(1, T, n_emb))
        self.drop = nn.Dropout(0.0)
        self.time_emb = SinusoidalPosEmb(n_emb)
        self.cond_obs_emb = nn.Linear(cond_dim, n_emb)
        self.cond_pos_emb = nn.Parameter(torch.zeros(1, T_cond, n_emb))
        self.encoder = nn.Sequential(nn.Linear(n_emb, 4 * n_emb), nn.Mish(), nn.Linear(4 * n_emb, n_emb))
        layer = nn.TransformerDecoderLayer(d_model=n_emb, nhead=n_head, dim_feedforward=4 * n_emb, dropout=p_drop_attn, activation="gelu", batch_first=True, norm_first=True)
        self.decoder = nn.TransformerDecoder(decoder_layer=layer, num_layers=n_layer)
        mask = (torch.triu(torch.ones(T, T)) == 1).transpose(0, 1)
        self.register_buffer("mask", mask.float().masked_fill(mask == 0, float("-inf")).masked_fill(mask == 1, float(0.0)))
        t, s = torch.meshgrid(torch.arange(T), torch.arange(T_cond), indexing="ij")
        mm = t >= (s - 1)
        self.register_buffer("memory_mask", mm.float().masked_fill(mm == 0, float("-inf")).masked_fill(mm == 1, float(0.0)))
        self.ln_f = nn.LayerNorm(n_emb)
        self.head = nn.Linear(n_emb, output_dim)

    def forward(self, sample, timestep, cond):
        timesteps = timestep.expand(sample.shape[0])
        time_emb = self.time_emb(timesteps).unsqueeze(1)
        input_emb = self.input_emb(sample)
        cond_embeddings = torch.cat([time_emb, self.cond_obs_emb(cond)], dim=1)
        tc = cond_embeddings.shape[1]
        x = self.drop(cond_embeddings + self.cond_pos_emb[:, :tc, :])
        memory = self.encoder(x)
        t = input_emb.shape[1]
        x = self.drop(input_emb + self.pos_emb[:, :t, :])
        x = self.decoder(tgt=x, memory=memory, tgt_mask=self.mask, memory_mask=self.memory_mask)
        return self.head(self.ln_f(x))


def dp_config(cid):
    from diffusers.schedulers.scheduling_ddim import DDIMScheduler
    cams, crop, To, Tp, Ta, da, low, steps = 2, (216, 288), 2, 16, 8, 2, 2, 8
    enc = ObsEncoder(cams, crop).eval()
    obs_feat = 64 * cams + low
    if cid == "diffusion-policy-cnn":
        net = ConditionalUnet1D(da, obs_feat * To, diffusion_step_embed_dim=128, down_dims=(256, 512, 1024), kernel_size=5, n_groups=8, cond_predict_scale=True).eval()
    else:
        net = TransformerForDiffusion(da, da, Tp, To, obs_feat, n_layer=8, n_head=4, n_emb=256).eval()
    sched = DDIMScheduler(num_train_timesteps=100, beta_start=0.0001, beta_end=0.02, beta_schedule="squaredcos_cap_v2", clip_sample=True, set_alpha_to_one=True, steps_offset=0, prediction_type="epsilon")
    sched.set_timesteps(steps)
    timesteps = [int(t) for t in sched.timesteps]
    imgs = [torch.zeros(To, 3, *crop) for _ in range(cams)]   # B·T_o filas por cámara, como predict_action
    low_x = torch.zeros(To, low)
    enc_names = {"c5": "obs_nets.0.nets.0", "kp-logits": "obs_nets.0.nets.1.nets", "keypoints": "obs_nets.0.nets.1", "cam-feat-pre": "obs_nets.0.nets.3",
                 "bb-stem-conv": "obs_nets.0.nets.0.0", "bb-pool": "obs_nets.0.nets.0.3", "c2": "obs_nets.0.nets.0.4", "c3": "obs_nets.0.nets.0.5", "c4": "obs_nets.0.nets.0.6"}
    if cid == "diffusion-policy-cnn":
        net_names = {"t-emb": "diffusion_step_encoder", "d1-r1-add": "down_modules.0.0", "d1-r2-add": "down_modules.0.1", "d1-down": "down_modules.0.2",
                     "d2-r2-add": "down_modules.1.1", "d2-down": "down_modules.1.2", "d3-r2-add": "down_modules.2.1", "m-r2-add": "mid_modules.1",
                     "u1-r1-add": "up_modules.0.0", "u1-up": "up_modules.0.2", "u2-r1-add": "up_modules.1.0", "u2-up": "up_modules.1.2",
                     "final-conv": "final_conv.0.block.0", "d1-r1-film-lin": "down_modules.0.0.cond_encoder.1"}
    else:
        net_names = {"x-emb": "input_emb", "cond-obs-emb": "cond_obs_emb", "memory": "encoder", "d-out": "decoder.layers.7", "x-ln": "ln_f", "d-u": "decoder.layers.0.linear1"}
    he, hn = Hooks(enc, enc_names), Hooks(net, net_names)
    traj = torch.zeros(1, Tp, da)

    def infer():
        with torch.no_grad():
            f = enc(imgs, low_x)                     # (T_o, 130)
            cond = f.reshape(1, -1) if cid == "diffusion-policy-cnn" else f.reshape(1, To, -1)
            for t in timesteps:
                tt = torch.tensor([t], dtype=torch.long)
                eps = net(traj, tt, cond) if cid == "diffusion-policy-cnn" else net(traj, tt, cond)
                sched.step(eps, t, traj)
    fl, by = flops_of(infer)
    he.remove()
    hn.remove()
    with torch.no_grad():
        f_enc, _ = flops_of(lambda: enc(imgs, low_x))
        fx = enc(imgs, low_x)
        cnd = fx.reshape(1, -1) if cid == "diffusion-policy-cnn" else fx.reshape(1, To, -1)
        f_net, _ = flops_of(lambda: net(traj, torch.tensor([timesteps[0]]), cnd))
    assert fl == f_enc + steps * f_net, (fl, f_enc, f_net)
    shapes = {"img": [crop[0], crop[1], 3], "noisy-actions": [Tp, da], "eps": [Tp, da], "denoised": [Tp, da], "action-exec": [Ta, da], "eef-pose": [low]}
    for tid, s in he.raw.items():
        assert s[0] == To, (tid, s)
        s = [1] + s[1:]
        shapes[tid] = nchw(s) if len(s) == 4 else nobatch(s)
    for tid, s in hn.raw.items():
        if cid == "diffusion-policy-cnn":
            shapes[tid] = nct(s) if len(s) == 3 else nobatch(s)
        else:
            shapes[tid] = nobatch(s)
    shapes["cam-feat"] = shapes["cam-feat-pre"]
    if cid == "diffusion-policy-cnn":
        shapes["obs-cond"] = [obs_feat * To]
        shapes["cond"] = [128 + obs_feat * To]
        pbn = {"obs-encoder": n_params(enc), "backbone": cams * n_params(enc.obs_nets[0].nets[0]), "kp-conv": cams * n_params(enc.obs_nets[0].nets[1]),
               "kp-linear": cams * n_params(enc.obs_nets[0].nets[3]), "unet": n_params(net), "time-embed": n_params(net.diffusion_step_encoder),
               "down-1": n_params(net.down_modules[0]), "down-2": n_params(net.down_modules[1]), "down-3": n_params(net.down_modules[2]), "mid": n_params(net.mid_modules),
               "up-1": n_params(net.up_modules[0]), "up-2": n_params(net.up_modules[1]), "final": n_params(net.final_conv)}
        ctor = "ConditionalUnet1D(2, global_cond_dim=260, diffusion_step_embed_dim=128, down_dims=[256, 512, 1024], kernel_size=5, n_groups=8, cond_predict_scale=True)"
    else:
        shapes["obs-tokens"] = [To, obs_feat]
        shapes["cond-tok"] = [1 + To, 256]
        pbn = {"obs-encoder": n_params(enc), "backbone": cams * n_params(enc.obs_nets[0].nets[0]), "transformer": n_params(net), "decoder": n_params(net.decoder),
               "input-emb": n_params(net.input_emb) + net.pos_emb.numel(), "cond": n_params(net.cond_obs_emb) + net.cond_pos_emb.numel() + n_params(net.encoder),
               "head": n_params(net.head), "ln-f": n_params(net.ln_f)}
        ctor = "TransformerForDiffusion(2, 2, horizon 16, n_obs_steps 2, cond_dim 130, n_layer 8, n_head 4, n_emb 256, causal_attn, time_as_cond, obs_as_cond, n_cond_layers 0)"
    data = {
        "config_id": cid, "model": "imitation",
        "params_total": n_params(enc) + n_params(net), "params_by_node": pbn, "shapes": shapes, "flops_total": fl, "flops_by_op": by,
        "flops_by_node": {"obs-encoder": f_enc, ("unet" if cid == "diffusion-policy-cnn" else "transformer"): steps * f_net},
        "ddim_timesteps": timesteps,
        "source": {"lib": "torch + torchvision + diffusers (transcrito de real-stanford/diffusion_policy 5ba07ac y robomimic 0.2.0)", "ctor": ctor + " + ObservationEncoder(2 × VisualCore(ResNet18Conv con GroupNorm, SpatialSoftmax 32, Linear 64 → 64))",
                   "versions": vers()},
        "notes": [
            "Una inferencia (predict_action): el encoder corre sobre T_o = 2 pasos × 2 cámaras (4 ResNet-18 a 216×288) y la red de ruido 8 veces (DDIM, timesteps " + ", ".join(map(str, timesteps)) + ").",
            "Cada cámara tiene su propio ResNet-18 (robomimic no comparte obs_nets entre claves rgb); BatchNorm → GroupNorm(C/16, C): γ y β = 2C parámetros, como la BN.",
            "SpatialSoftmax: la conv 1×1 a 32 mapas cuenta; el softmax y los promedios de posición no (FlopCounterMode).",
            "ConditionalUnet1D: el skip del nivel 1 (256 canales a 16) se guarda y nunca se usa (h tiene 3 entradas y solo se sacan 2).",
        ],
    }
    write_expected(cid, data)
    print(f"  {cid}: params {data['params_total']:,} (encoder {n_params(enc):,} + red {n_params(net):,}) · {fl // 2:,} MACs", file=sys.stderr)


# ================================================================== imitation: BC (CNNMLP de tonyzhaozh/act)
class CNNMLP(nn.Module):
    """detr/models/detr_vae.py class CNNMLP + mlp(), con un Joiner (resnet18 FrozenBN) por cámara."""

    def __init__(self, cams):
        super().__init__()
        self.cams = cams
        self.action_head = nn.Linear(1000, 14)   # definido y sin uso
        self.backbones = nn.ModuleList([Joiner(512) for _ in range(cams)])
        self.backbone_down_projs = nn.ModuleList([nn.Sequential(nn.Conv2d(512, 128, kernel_size=5), nn.Conv2d(128, 64, kernel_size=5), nn.Conv2d(64, 32, kernel_size=5)) for _ in range(cams)])
        mlp_in_dim = 768 * cams + 14
        self.mlp = nn.Sequential(nn.Linear(mlp_in_dim, 1024), nn.ReLU(inplace=True), nn.Linear(1024, 1024), nn.ReLU(inplace=True), nn.Linear(1024, 14))

    def forward(self, qpos, image):
        bs, _ = qpos.shape
        feats = []
        for cam_id in range(self.cams):
            features, pos = self.backbones[cam_id](image[:, cam_id])
            feats.append(self.backbone_down_projs[cam_id](features[0]))
        flat = torch.cat([f.reshape([bs, -1]) for f in feats], axis=1)
        return self.mlp(torch.cat([flat, qpos], axis=1))


def bc_config():
    cams, H, W = 4, 480, 640
    m = CNNMLP(cams).eval()
    names = {"c5": "backbones.0.body.layer4", "c4": "backbones.0.body.layer3", "c3": "backbones.0.body.layer2", "c2": "backbones.0.body.layer1",
             "bb-stem-conv": "backbones.0.body.conv1", "bb-pool": "backbones.0.body.maxpool", "down-conv1": "backbone_down_projs.0.0", "down-conv2": "backbone_down_projs.0.1",
             "down-conv3": "backbone_down_projs.0.2", "mlp-h1": "mlp.0", "mlp-h2": "mlp.2", "action": "mlp.4"}
    hk = Hooks(m, names)
    with torch.no_grad():
        fl, by = flops_of(lambda: m(torch.zeros(1, 14), torch.zeros(1, cams, 3, H, W)))
    hk.remove()
    shapes = {"img": [H, W, 3], "qpos": [14], "cam-flat": [768], "mlp-in": [768 * cams + 14]}
    for tid, s in hk.raw.items():
        shapes[tid] = nchw(s) if len(s) == 4 else nobatch(s)
    pbn = {"backbone": n_params(m.backbones), "down-proj": n_params(m.backbone_down_projs), "mlp": n_params(m.mlp), "idle": n_params(m.action_head)}
    data = {
        "config_id": "bc-mlp", "model": "imitation",
        "params_total": n_params(m), "params_by_node": pbn, "shapes": shapes, "flops_total": fl, "flops_by_op": by,
        "source": {"lib": "torch + torchvision (transcrito de tonyzhaozh/act 742c753 detr/models/detr_vae.py, CNNMLP)", "ctor": "CNNMLP(4 backbones resnet18 FrozenBN, down_proj 512 → 128 → 64 → 32, mlp 3086 → 1024 → 1024 → 14)", "versions": vers()},
        "notes": ["Un ResNet-18 por cámara (build_cnnmlp crea un backbone por camera_name): 4 copias de los pesos.",
                  "action_head = nn.Linear(1000, 14) existe (14,014 parámetros) y forward no la usa.",
                  "down_proj: 3 convs 5×5 sin activación entre ellas (nn.Sequential de Conv2d)."],
    }
    write_expected("bc-mlp", data)
    print(f"  bc-mlp: params {data['params_total']:,} · {fl // 2:,} MACs", file=sys.stderr)


def main():
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    dims = env_dims()
    for cid in ("ppo-mujoco", "ppo-atari", "ppo-anymal-isaac"):
        rl_config(cid, dims)
    act_config("act-aloha", False)
    act_config("act-aloha-train", True)
    dp_config("diffusion-policy-cnn")
    dp_config("diffusion-policy-transformer")
    bc_config()


if __name__ == "__main__":
    main()
