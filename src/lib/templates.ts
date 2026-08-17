import type { PrismDocument } from "./document";
import { STARTER_EDGES, STARTER_NODES } from "./starter-graph";
import { STUDENT_LAB_PROMPT } from "./student-lab";
import { STUDENT_TEACHER_EDGES, STUDENT_TEACHER_NODES } from "./student-graph";

export type ArchitectureTemplate = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  build: () => Pick<
    PrismDocument,
    "name" | "description" | "tags" | "prompt" | "nodes" | "edges" | "templateId"
  >;
};

function cloneStarter() {
  return {
    nodes: STARTER_NODES.map((n) => ({
      ...n,
      data: { ...n.data },
      position: { ...n.position },
    })),
    edges: STARTER_EDGES.map((e) => ({ ...e })),
  };
}

export const TEMPLATES: ArchitectureTemplate[] = [
  {
    id: "starter-moa",
    name: "Starter MoA",
    description: "Context Hub → Split → Researcher / Writer / Critic → Judge",
    tags: ["moa", "default"],
    build: () => {
      const g = cloneStarter();
      return {
        name: "Starter MoA",
        description: "Classic mixture-of-agents critique loop",
        tags: ["moa", "default"],
        prompt: "",
        templateId: "starter-moa",
        nodes: g.nodes,
        edges: g.edges,
      };
    },
  },
  {
    id: "debate",
    name: "Parallel debate",
    description: "Two specialists disagree, Judge synthesizes",
    tags: ["debate", "moa"],
    build: () => {
      const g = cloneStarter();
      const keep = new Set(["context", "router", "research", "critique", "judge"]);
      return {
        name: "Parallel debate",
        description: "Researcher vs Critic → Judge",
        tags: ["debate", "moa"],
        prompt: "",
        templateId: "debate",
        nodes: g.nodes.filter((n) => keep.has(n.id)).map((n) => {
          if (n.id === "research") {
            return {
              ...n,
              data: {
                ...n.data,
                label: "Advocate",
                role: "Argue the strongest affirmative case",
                steer: "Steelman the yes-case; don’t hedge into both-sides mush.",
              },
            };
          }
          if (n.id === "critique") {
            return {
              ...n,
              data: {
                ...n.data,
                label: "Skeptic",
                role: "Argue the strongest opposing case",
                steer: "Steelman the no-case; name the kill-shots clearly.",
              },
            };
          }
          return n;
        }),
        edges: g.edges.filter(
          (e) => keep.has(e.source) && keep.has(e.target) && e.source !== "draft" && e.target !== "draft",
        ),
      };
    },
  },
  {
    id: "blank",
    name: "Blank canvas",
    description: "Context Hub + Split only — build your own pathway",
    tags: ["blank"],
    build: () => {
      const g = cloneStarter();
      const keep = new Set(["context", "router"]);
      return {
        name: "Blank canvas",
        description: "Minimal vertical spine",
        tags: ["blank"],
        prompt: "",
        templateId: "blank",
        nodes: g.nodes.filter((n) => keep.has(n.id)),
        edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      };
    },
  },
  {
    id: "student-teachers",
    name: "Student vs teachers",
    description: "Hub → Nemo (Foundry) + independent teachers → Judge. No Split.",
    tags: ["student", "foundry", "moa"],
    build: () => ({
      name: "Student vs teachers",
      description: "Nemo attempts first; teachers share Hub only; Judge names characteristics",
      tags: ["student", "foundry", "moa"],
      prompt: STUDENT_LAB_PROMPT,
      templateId: "student-teachers",
      nodes: STUDENT_TEACHER_NODES.map((n) => ({
        ...n,
        data: { ...n.data },
        position: { ...n.position },
      })),
      edges: STUDENT_TEACHER_EDGES.map((e) => ({ ...e })),
    }),
  },
];

export function getTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
