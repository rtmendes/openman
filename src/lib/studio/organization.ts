import { z } from "zod";

export const studioProjectLimit = 100;
export const studioBatchLimit = 12;
export const studioSidebarMinWidth = 160;
export const studioSidebarMaxWidth = 380;
export const studioUnassigned = "unassigned";
export const studioSecondSpring = "second-spring";
export const brandIdSchema = z.union([z.uuid(), z.literal(studioSecondSpring), z.literal(studioUnassigned)]);
export const studioStages = {
  brief: "Brief", scripting: "Scripting", review: "Script review", production: "In production", ready: "Ready to share", archived: "Archived",
} as const;
const stageKeys = ["brief", "scripting", "review", "production", "ready", "archived"] as const;
export const studioStageSchema = z.enum(stageKeys);
export const studioProjectOrganizationSchema = z.object({
  brandId: brandIdSchema.optional(), folderId: z.uuid().optional(),
  title: z.string().trim().max(120).optional(), useCase: z.string().trim().max(80).optional(),
  stage: studioStageSchema.optional(),
});
const brandSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), context: z.string().max(5000) });
const folderSchema = z.object({ id: z.uuid(), brandId: brandIdSchema, name: z.string().trim().min(1).max(90), parentId: z.uuid().nullable() });
export const studioOrganizationSchema = z.object({
  brands: z.array(brandSchema).max(100),
  folders: z.array(folderSchema).max(500),
  sidebar: z.object({ side: z.enum(["left", "right"]), width: z.number().int().min(studioSidebarMinWidth).max(studioSidebarMaxWidth), collapsed: z.boolean() }),
}).superRefine(({ brands, folders }, ctx) => {
  const brandIds = new Set<string>([studioUnassigned, studioSecondSpring]);
  const brandNames = new Set<string>(["second spring", "unassigned"]);
  for (const brand of brands) {
    const name = brand.name.toLocaleLowerCase();
    if (brandIds.has(brand.id) || brandNames.has(name)) ctx.addIssue({ code: "custom", message: "Brand names must be unique." });
    brandIds.add(brand.id);
    brandNames.add(name);
  }
  const index = new Map(folders.map((folder) => [folder.id, folder]));
  if (index.size !== folders.length) ctx.addIssue({ code: "custom", message: "Folder IDs must be unique." });
  for (const folder of folders) {
    if (!brandIds.has(folder.brandId)) ctx.addIssue({ code: "custom", message: "Assign each folder to a workspace brand." });
    let parentId = folder.parentId;
    const visited = new Set([folder.id]);
    while (parentId) {
      const parent = index.get(parentId);
      if (!parent || parent.brandId !== folder.brandId || visited.has(parentId) || visited.size >= 8) {
        ctx.addIssue({ code: "custom", message: "Use a parent folder in the same brand, up to eight levels deep." });
        break;
      }
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }
});

export type StudioOrganization = z.infer<typeof studioOrganizationSchema>;
export type StudioProjectOrganization = z.infer<typeof studioProjectOrganizationSchema>;
export type StudioFolder = z.infer<typeof folderSchema>;
export type StudioBrand = z.infer<typeof brandSchema>;
export type StudioStage = z.infer<typeof studioStageSchema>;
export type StudioLocation = { brandId: string; folderId?: string };
export const defaultStudioOrganization: StudioOrganization = { brands: [], folders: [], sidebar: { side: "left", width: 244, collapsed: false } };

type LocatedProject = { kit: string; spec: { brand: string }; organization?: StudioProjectOrganization };

export function studioProjectLocation(project: LocatedProject, organization: StudioOrganization): StudioLocation {
  const savedBrand = project.organization?.brandId;
  const inferred = project.kit === studioSecondSpring ? studioSecondSpring
    : organization.brands.find(({ name }) => name.toLocaleLowerCase() === project.spec.brand.trim().toLocaleLowerCase())?.id;
  const brandId = savedBrand && (savedBrand === studioUnassigned || savedBrand === studioSecondSpring || organization.brands.some(({ id }) => id === savedBrand))
    ? savedBrand : inferred || studioUnassigned;
  const folderId = organization.folders.find((folder) => folder.id === project.organization?.folderId && folder.brandId === brandId)?.id;
  return { brandId, folderId };
}

export function studioFolderTrail(folderId: string | undefined, folders: StudioFolder[]) {
  const trail: StudioFolder[] = [];
  let current = folders.find(({ id }) => id === folderId);
  while (current && trail.length < 8 && !trail.some(({ id }) => id === current?.id)) {
    trail.unshift(current);
    const parent = current.parentId;
    current = folders.find(({ id }) => id === parent);
  }
  return trail;
}
