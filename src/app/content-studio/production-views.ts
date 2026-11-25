export const productionViews = [
  { id: "brief", title: "Brief", image: "research", synopsis: "Choose a topic, audience, runtime, and production format." },
  { id: "research", title: "Research", image: "research", agentStage: 1, synopsis: "Find relevant sources, shortlist keywords, and build a research brief." },
  { id: "script", title: "Script", image: "script", agentStage: 6, synopsis: "Write the narration and shots, then approve the draft for production." },
  { id: "packaging", title: "Titles & covers", image: "packaging", agentStage: 2, synopsis: "Generate and compare three title and thumbnail options." },
  { id: "narration", title: "Narration", image: "narration", synopsis: "Hear delivery samples and set the English voice and pace." },
  { id: "shots", title: "Storyboard", image: "shots", synopsis: "Attach media, assign reference frames, and assemble the cut." },
  { id: "review", title: "Review & export", image: "review", synopsis: "Play private renders and export the approved production package." },
] as const;

export type ProductionView = (typeof productionViews)[number]["id"];
