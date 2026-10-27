import { z } from 'zod';
/** A bare host: no scheme, no path, no port. `localhost` is the only single-label host. */
export const Hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/,
    'Use a bare host such as shop.example.vn',
  )
  // A single label (`vn`, `com`) would match every subdomain; only `localhost` may be one.
  .refine(
    (host) => host === 'localhost' || host.includes('.'),
    'Use a bare host such as shop.example.vn',
  );
export const WebsiteSettings = z.object({
  domains: z.array(Hostname).min(1).max(10),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#F97316'),
  position: z.enum(['left', 'right']).default('right'),
  agentName: z.string().trim().min(1).max(60).default('Tư vấn viên'),
  avatarUrl: z
    .url({ protocol: /^https$/ })
    .nullable()
    .default(null),
  greeting: z.string().trim().min(1).max(300).default('Chào anh/chị, em có thể hỗ trợ gì ạ?'),
  phonePrompt: z
    .string()
    .trim()
    .max(300)
    .default('Anh/chị để lại số điện thoại để bên em gọi tư vấn kỹ hơn nhé.'),
  phoneChipText: z.string().trim().min(1).max(60).default('Gửi số điện thoại để được gọi lại'),
  requirePhoneAfter: z.number().int().min(0).max(20).default(0),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettings>;
export const CreateWebsiteRequest = z.object({
  name: z.string().trim().min(1).max(100),
  domains: WebsiteSettings.shape.domains,
  botId: z.uuid().nullable().optional(),
});
export type CreateWebsiteRequest = z.infer<typeof CreateWebsiteRequest>;
/** Partial update; `.partial()` alone would re-apply the defaults and reset untouched fields. */
const shape = WebsiteSettings.shape;
/** Strict: an unknown key (for example a nested `settings` object) is a 400, never a silent no-op. */
export const UpdateWebsiteRequest = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  domains: shape.domains.optional(),
  color: shape.color.unwrap().optional(),
  position: shape.position.unwrap().optional(),
  agentName: shape.agentName.unwrap().optional(),
  avatarUrl: shape.avatarUrl.unwrap().optional(),
  greeting: shape.greeting.unwrap().optional(),
  phonePrompt: shape.phonePrompt.unwrap().optional(),
  phoneChipText: shape.phoneChipText.unwrap().optional(),
  requirePhoneAfter: shape.requirePhoneAfter.unwrap().optional(),
});
export type UpdateWebsiteRequest = z.infer<typeof UpdateWebsiteRequest>;
