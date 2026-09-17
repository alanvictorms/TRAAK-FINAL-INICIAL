"""Interpretador do grafo de automação — puro, sem banco e sem rede.

`advance()` anda pelo grafo a partir de um nó e devolve o que deveria
acontecer (efeitos) e onde parou. Quem aplica os efeitos é o executor
(`automation_runner.py`); o teste isolado aplica nenhum. É isso que garante
que o teste mostra exatamente o que a execução real faria.

Formato do grafo (o do editor visual, @xyflow/react):
  nodes: [{id, data: {kind, label, config}}]
  edges: [{source, target, sourceHandle?}]
"""
import random
import re
from typing import Any, Dict, List, Optional

MAX_STEPS = 50          # proteção contra ciclo no grafo
MAX_WAIT_MINUTES = 60 * 24 * 30

CONDITION_FIELDS = {"message", "tag", "has_ftd", "source", "stage"}
CONDITION_OPERATORS = {"contains", "equals", "not_contains", "exists", "not_exists"}
ACTION_KINDS = {"close_conversation", "reopen_conversation"}


class GraphError(ValueError):
    pass


def _nodes_by_id(graph):
    return {n["id"]: n for n in graph.get("nodes") or []}


def _kind(node):
    data = node.get("data") or {}
    return data.get("kind") or node.get("type")


def _config(node):
    return (node.get("data") or {}).get("config") or {}


def next_node(graph, node_id: str, handle: Optional[str] = None) -> Optional[str]:
    """Destino da aresta que sai de `node_id` pelo `handle` (None = saída única)."""
    for edge in graph.get("edges") or []:
        if edge.get("source") != node_id:
            continue
        edge_handle = edge.get("sourceHandle")
        if handle is None and edge_handle in (None, "", "out"):
            return edge.get("target")
        if handle is not None and edge_handle == handle:
            return edge.get("target")
    return None


def render(text: str, ctx: Dict[str, Any]) -> str:
    """{nome} e {primeiro_nome} viram o nome do lead."""
    name = (ctx.get("player_name") or "").strip()
    return (text or "").replace("{nome}", name or "").replace("{primeiro_nome}", name.split(" ")[0] if name else "")


def menu_text(config) -> str:
    options = [o for o in config.get("options") or [] if str(o).strip()]
    lines = [config.get("text") or "Escolha uma opção:"]
    lines += [f"{i + 1}. {o}" for i, o in enumerate(options)]
    return "\n".join(lines)


def menu_choice(config, reply: str) -> str:
    """Resposta '2' ou o texto da opção → 'opt-1'. Qualquer outra coisa → 'other'."""
    options = [str(o).strip() for o in config.get("options") or [] if str(o).strip()]
    answer = (reply or "").strip().lower()
    match = re.match(r"^\s*(\d+)", answer)
    if match and 1 <= int(match.group(1)) <= len(options):
        return f"opt-{int(match.group(1)) - 1}"
    for i, option in enumerate(options):
        if answer == option.lower():
            return f"opt-{i}"
    return "other"


def evaluate_condition(config, ctx) -> bool:
    field = config.get("field", "message")
    op = config.get("operator", "contains")
    expected = str(config.get("value") or "").strip().lower()
    if field == "message":
        actual = (ctx.get("message") or "").lower()
    elif field == "tag":
        tags = [t.lower() for t in ctx.get("tags") or []]
        if op in ("exists", "not_exists"):
            return bool(tags) if op == "exists" else not tags
        has = expected in tags
        return has if op in ("contains", "equals") else not has
    elif field == "has_ftd":
        return bool(ctx.get("has_ftd")) if op != "not_exists" else not ctx.get("has_ftd")
    elif field == "source":
        actual = (ctx.get("source") or "").lower()
    elif field == "stage":
        actual = (ctx.get("stage") or "").lower()
    else:
        return False
    if op == "exists":
        return bool(actual)
    if op == "not_exists":
        return not actual
    if op == "equals":
        return actual == expected
    if op == "not_contains":
        return expected not in actual
    return expected in actual


def validate(graph) -> List[str]:
    """Problemas que impedem publicar. Lista vazia = pode publicar."""
    problems = []
    nodes = _nodes_by_id(graph)
    triggers = [n for n in nodes.values() if _kind(n) == "trigger"]
    if len(triggers) != 1:
        problems.append("O fluxo precisa de exatamente um bloco de início")
    elif not next_node(graph, triggers[0]["id"]):
        problems.append("Conecte o início a algum bloco")
    for edge in graph.get("edges") or []:
        if edge.get("source") not in nodes or edge.get("target") not in nodes:
            problems.append("Há conexão apontando para bloco inexistente")
            break
    for node in nodes.values():
        kind, cfg, label = _kind(node), _config(node), (node.get("data") or {}).get("label") or node["id"]
        if kind == "message" and not str(cfg.get("text") or "").strip():
            problems.append(f"“{label}”: mensagem vazia")
        if kind == "wait":
            try:
                minutes = float(cfg.get("minutes"))
                if not 0 < minutes <= MAX_WAIT_MINUTES:
                    raise ValueError
            except (TypeError, ValueError):
                problems.append(f"“{label}”: espera deve ser entre 1 minuto e 30 dias")
        if kind == "condition":
            if cfg.get("field", "message") not in CONDITION_FIELDS or cfg.get("operator", "contains") not in CONDITION_OPERATORS:
                problems.append(f"“{label}”: condição inválida")
        if kind == "menu" and not [o for o in cfg.get("options") or [] if str(o).strip()]:
            problems.append(f"“{label}”: menu sem opções")
        if kind == "webhook" and not str(cfg.get("url") or "").startswith(("http://", "https://")):
            problems.append(f"“{label}”: URL do webhook inválida")
        if kind == "action" and cfg.get("kind") not in ACTION_KINDS:
            problems.append(f"“{label}”: escolha a ação")
        if kind == "ai" and not str(cfg.get("prompt") or "").strip():
            problems.append(f"“{label}”: escreva a instrução para a IA")
    return problems


def advance(graph, start_id: str, ctx: Dict[str, Any], *, resume_reply: Optional[str] = None,
            rnd: Optional[random.Random] = None) -> Dict[str, Any]:
    """Executa do nó `start_id` até pausar ou acabar.

    `resume_reply` só vale quando `start_id` é um menu que estava esperando
    resposta: a resposta escolhe o caminho. Devolve
    {status, current, visited, effects, pause}.
    status: completed | waiting | failed.
    """
    nodes = _nodes_by_id(graph)
    rnd = rnd or random
    effects, visited = [], []
    current = start_id
    reply = resume_reply

    for _ in range(MAX_STEPS):
        node = nodes.get(current)
        if node is None:
            return {"status": "completed", "current": None, "visited": visited, "effects": effects, "pause": None}
        kind, cfg = _kind(node), _config(node)
        handle = None

        if reply is not None and kind == "menu":
            # Voltando de uma pausa de menu: a resposta decide a saída.
            handle = menu_choice(cfg, reply)
            reply = None
            target = next_node(graph, current, handle) or (next_node(graph, current, "other") if handle != "other" else None)
            effects.append({"type": "log", "node": current, "text": f"resposta escolheu {handle}"})
            if target is None:
                return {"status": "completed", "current": current, "visited": visited, "effects": effects, "pause": None}
            current = target
            continue

        visited.append(current)
        if kind == "trigger":
            pass
        elif kind == "message":
            effects.append({"type": "send", "node": current, "text": render(cfg.get("text"), ctx)})
        elif kind == "wait":
            minutes = float(cfg.get("minutes") or 0)
            after = next_node(graph, current)
            if after is None:
                return {"status": "completed", "current": current, "visited": visited, "effects": effects, "pause": None}
            return {"status": "waiting", "current": after, "visited": visited, "effects": effects,
                    "pause": {"kind": "delay", "minutes": minutes}}
        elif kind == "condition":
            handle = "yes" if evaluate_condition(cfg, ctx) else "no"
            effects.append({"type": "log", "node": current, "text": f"condição → {'sim' if handle == 'yes' else 'não'}"})
        elif kind == "tags":
            add = [str(t).strip().lower() for t in cfg.get("add") or [] if str(t).strip()]
            remove = [str(t).strip().lower() for t in cfg.get("remove") or [] if str(t).strip()]
            effects.append({"type": "tags", "node": current, "add": add, "remove": remove})
            ctx["tags"] = [t for t in (ctx.get("tags") or []) if t not in remove] + [t for t in add if t not in (ctx.get("tags") or [])]
        elif kind == "crm_action":
            effects.append({"type": "stage", "node": current, "stage": cfg.get("stage") or ""})
            ctx["stage"] = cfg.get("stage") or ""
        elif kind == "menu":
            effects.append({"type": "send", "node": current, "text": render(menu_text(cfg), ctx)})
            return {"status": "waiting", "current": current, "visited": visited, "effects": effects,
                    "pause": {"kind": "reply"}}
        elif kind == "random":
            branches = max(2, int(cfg.get("branches") or 2))
            handle = f"r-{rnd.randrange(branches)}"
            effects.append({"type": "log", "node": current, "text": f"sorteado caminho {handle}"})
        elif kind == "action":
            effects.append({"type": cfg.get("kind"), "node": current})
        elif kind == "ai":
            effects.append({"type": "ai_reply", "node": current, "prompt": cfg.get("prompt") or ""})
        elif kind == "webhook":
            effects.append({"type": "webhook", "node": current, "url": cfg.get("url")})
        elif kind == "handoff":
            effects.append({"type": "handoff", "node": current, "agent_id": cfg.get("agent_id") or None})
            # Transferir encerra o fluxo: dali em diante é gente.
            return {"status": "completed", "current": current, "visited": visited, "effects": effects, "pause": None}
        else:
            return {"status": "failed", "current": current, "visited": visited, "effects": effects,
                    "pause": None, "error": f"bloco desconhecido: {kind}"}

        target = next_node(graph, current, handle)
        if target is None:
            return {"status": "completed", "current": current, "visited": visited, "effects": effects, "pause": None}
        current = target

    return {"status": "failed", "current": current, "visited": visited, "effects": effects, "pause": None,
            "error": f"fluxo passou de {MAX_STEPS} passos — há um ciclo sem espera"}


def trigger_id(graph) -> Optional[str]:
    return next((n["id"] for n in graph.get("nodes") or [] if _kind(n) == "trigger"), None)


def simulate(graph, ctx: Dict[str, Any], replies: List[str], rnd: Optional[random.Random] = None) -> List[Dict[str, Any]]:
    """Teste isolado: percorre o fluxo inteiro, pulando esperas e usando as respostas dadas."""
    start = trigger_id(graph)
    if not start:
        raise GraphError("Fluxo sem bloco de início")
    transcript = []
    replies = list(replies)
    current, reply = start, None
    for _ in range(MAX_STEPS):
        result = advance(graph, current, ctx, resume_reply=reply, rnd=rnd)
        transcript.extend(result["effects"])
        if result["status"] != "waiting":
            transcript.append({"type": "end", "status": result["status"], "error": result.get("error")})
            return transcript
        pause = result["pause"]
        if pause["kind"] == "delay":
            transcript.append({"type": "wait", "minutes": pause["minutes"]})
            current, reply = result["current"], None
        else:
            if not replies:
                transcript.append({"type": "end", "status": "waiting_reply"})
                return transcript
            reply = replies.pop(0)
            transcript.append({"type": "reply", "text": reply})
            ctx["message"] = reply
            current = result["current"]
    transcript.append({"type": "end", "status": "failed", "error": "simulação longa demais"})
    return transcript
