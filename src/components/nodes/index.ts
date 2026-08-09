import type { NodeTypes } from "@xyflow/react";
import { AgentNode } from "./agent-node";
import { ContextNode } from "./context-node";
import { ContextSourceNode } from "./context-source-node";
import { MergeNode } from "./merge-node";
import { RouterNode } from "./router-node";

export const nodeTypes: NodeTypes = {
  context: ContextNode,
  "context-source": ContextSourceNode,
  agent: AgentNode,
  router: RouterNode,
  merge: MergeNode,
};
