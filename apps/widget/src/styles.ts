/** Widget CSS, injected into the shadow root. `--c` is the brand colour. */
export const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.root{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1f2328}
.root.left .bubble,.root.left .panel{left:20px}
.root.right .bubble,.root.right .panel{right:20px}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;padding:0}
.bubble{position:fixed;bottom:20px;width:56px;height:56px;border-radius:50%;background:var(--c);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.25);transition:transform .15s}
.bubble:hover{transform:scale(1.06)}
.bubble:focus-visible,.panel button:focus-visible{outline:2px solid #1f2328;outline-offset:2px}
.bubble svg{width:28px;height:28px;fill:currentColor}
.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#d1242f;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.badge[hidden]{display:none}
.panel{position:fixed;bottom:88px;width:360px;height:min(560px,calc(100vh - 108px));background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;animation:pop .18s ease-out}
.panel[hidden]{display:none}
.head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--c);color:#fff}
.avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);object-fit:cover;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.name{flex:1;font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbtn{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff}
.hbtn:hover{background:rgba(255,255,255,.2)}
.list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9;overscroll-behavior:contain}
.msg{max-width:80%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.agent{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}
.msg.customer{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px}
.msg.pending{opacity:.6}
.msg.failed{background:#fde8e8;color:#8a1c1c;border:1px solid #f3b4b4;cursor:pointer}
.msg img{display:block;max-width:100%;max-height:240px;border-radius:8px}
.msg .note{display:block;font-size:12px;margin-top:4px}
.typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:14px}
.typing[hidden]{display:none}
.typing i{width:6px;height:6px;border-radius:50%;background:#8b949e;animation:blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
.notice{padding:6px 14px;font-size:12px;color:#8a1c1c;background:#fde8e8}
.notice[hidden]{display:none}
.chip{margin:0 14px 8px;align-self:flex-start;padding:6px 12px;border-radius:999px;border:1px solid var(--c);color:var(--c);font-size:13px;background:#fff}
.chip[hidden]{display:none}
form{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}
form[hidden]{display:none}
textarea,input[type=tel]{flex:1;min-width:0;font:inherit;font-size:16px;border:1px solid #d0d7de;border-radius:10px;padding:8px 10px;resize:none;max-height:96px;color:#1f2328;background:#fff}
textarea:focus,input[type=tel]:focus{outline:2px solid var(--c);outline-offset:-1px}
.ibtn{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;color:#57606a}
.ibtn:hover{background:#f0f2f4}
.send{background:var(--c);color:#fff;padding:8px 14px;border-radius:10px;font-weight:600;flex:none}
.send:disabled{opacity:.5;cursor:default}
.phoneform{flex-wrap:wrap}
.phoneform .hint{flex-basis:100%;font-size:13px;color:#57606a;margin:0}
.phoneform .err{flex-basis:100%;font-size:12px;color:#8a1c1c;margin:0}
.phoneform .err[hidden]{display:none}
.link{color:#57606a;font-size:13px;padding:8px}
@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media (max-width:640px){
 .panel{left:0!important;right:0!important;top:0;bottom:0;width:100%;height:100%;border-radius:0;animation:none}
 .root.open .bubble{display:none}
}
@media (prefers-reduced-motion:reduce){
 .panel{animation:none}.bubble{transition:none}.typing i{animation:none;opacity:.6}
}
`;
