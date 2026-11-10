/**
 * Widget CSS, injected into the shadow root, after the Rapiz brand (v2): one neutral family, radius
 * 4px control / 8px card / 16px frame, Inter when the page has it, short ease-out motion. `--c` is
 * the site's colour and `--on-c` the text on it (charcoal or white, see `onColor`).
 */
export const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.root{font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1f1f1f;-webkit-font-smoothing:antialiased}
.root.left .bubble,.root.left .panel{left:20px}
.root.right .bubble,.root.right .panel{right:20px}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;padding:0}
svg{width:20px;height:20px;fill:currentColor;flex:none}
.bubble{position:fixed;bottom:20px;width:56px;height:56px;border-radius:16px;background:var(--c);color:var(--on-c);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(31,31,31,.12),0 8px 24px rgba(31,31,31,.16);transition:transform .12s ease-out,box-shadow .12s ease-out}
.bubble:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(31,31,31,.12),0 12px 28px rgba(31,31,31,.18)}
.bubble svg{width:26px;height:26px}
.root.open .bubble{transform:none}
button:focus-visible{outline:2px solid #b54708;outline-offset:2px}
.badge{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#d92d20;color:#fff;font-size:12px;font-weight:600;line-height:20px;text-align:center;box-shadow:0 0 0 2px #fff}
.badge[hidden]{display:none}
.panel{position:fixed;bottom:88px;width:380px;height:min(600px,calc(100vh - 112px));background:#fff;border-radius:16px;border:1px solid #e4e7ec;box-shadow:0 2px 4px rgba(31,31,31,.06),0 16px 40px rgba(31,31,31,.16);display:flex;flex-direction:column;overflow:hidden;animation:pop .16s ease-out}
.panel[hidden]{display:none}
.head{display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;background:#fff;border-bottom:1px solid #f3f4f6}
.avatar{width:36px;height:36px;border-radius:50%;background:var(--c);color:var(--on-c);object-fit:cover;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.title{flex:1;min-width:0}
.name{font-weight:600;font-size:15px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:#5d6470}
.status:before{content:"";width:6px;height:6px;border-radius:50%;background:#067647}
.hbtn{width:32px;height:32px;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#5d6470;transition:background .12s ease-out}
.hbtn:hover{background:#f3f4f6;color:#1f1f1f}
.list{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#f8f9fb;overscroll-behavior:contain}
.msg{max-width:82%;padding:8px 12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.agent{align-self:flex-start;background:#fff;border:1px solid #e4e7ec;border-top-left-radius:2px}
.msg.customer{align-self:flex-end;background:var(--c);color:var(--on-c);border-top-right-radius:2px}
.msg.pending{opacity:.6}
.msg.failed{background:#fef3f2;color:#d92d20;border:1px solid #fecdca;cursor:pointer}
.msg img{display:block;max-width:100%;max-height:240px;border-radius:4px}
.msg .note{display:block;font-size:12px;margin-top:4px}
.typing{align-self:flex-start;display:flex;gap:4px;padding:12px;background:#fff;border:1px solid #e4e7ec;border-radius:8px;border-top-left-radius:2px}
.typing[hidden]{display:none}
.typing i{width:6px;height:6px;border-radius:50%;background:#5d6470;animation:blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
.notice{padding:8px 16px;font-size:12px;color:#d92d20;background:#fef3f2;border-top:1px solid #fecdca}
.notice[hidden]{display:none}
.chip{margin:0 16px 8px;align-self:flex-start;padding:6px 12px;border-radius:4px;border:1px solid #d0d5dd;background:#fff;font-size:13px;font-weight:500;transition:border-color .12s ease-out}
.chip:hover{border-color:var(--c)}
.chip[hidden]{display:none}
form{padding:12px;background:#fff;border-top:1px solid #f3f4f6}
form[hidden]{display:none}
.field{display:flex;align-items:flex-end;gap:4px;padding:4px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;transition:border-color .12s ease-out}
.field:focus-within{border-color:#5d6470}
textarea,input[type=tel]{flex:1;min-width:0;font:inherit;font-size:16px;line-height:24px;border:0;padding:4px 4px;resize:none;max-height:120px;color:#1f1f1f;background:transparent}
textarea::placeholder,input[type=tel]::placeholder{color:#5d6470;opacity:1}
textarea:focus,input[type=tel]:focus{outline:none}
.ibtn{width:32px;height:32px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:none;color:#5d6470;transition:background .12s ease-out}
.ibtn:hover{background:#f3f4f6;color:#1f1f1f}
.send{width:32px;height:32px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--c);color:var(--on-c);font-weight:600;transition:opacity .12s ease-out}
.send:disabled{opacity:.4;cursor:default}
.send.text{width:auto;height:40px;padding:0 16px}
.phoneform{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.phoneform .hint{flex-basis:100%;font-size:13px;color:#5d6470;margin:0}
.phoneform input[type=tel]{height:40px;padding:8px 12px;border:1px solid #d0d5dd;border-radius:4px}
.phoneform input[type=tel]:focus{border-color:#5d6470}
.phoneform .err{flex-basis:100%;font-size:12px;color:#d92d20;margin:0}
.phoneform .err[hidden]{display:none}
.link{color:#5d6470;font-size:13px;padding:8px;border-radius:4px}
.link:hover{color:#1f1f1f}
@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media (max-width:640px){
 .panel{left:0!important;right:0!important;top:0;bottom:0;width:100%;height:100%;border-radius:0;border:0;animation:none}
 .root.open .bubble{display:none}
}
@media (pointer:coarse){.hbtn,.ibtn,.send{width:44px;height:44px}.send.text{height:44px}}
@media (prefers-reduced-motion:reduce){
 .panel{animation:none}.bubble,.bubble:hover{transition:none;transform:none}.typing i{animation:none;opacity:.6}
}
`;
