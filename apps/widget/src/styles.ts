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
.carousel{position:relative;align-self:stretch;margin:0 -16px}
.cards{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 16px;padding:2px 16px 8px;scrollbar-width:none;overscroll-behavior-x:contain}
.cards::-webkit-scrollbar{display:none}
.card{position:relative;flex:0 0 176px;scroll-snap-align:start;display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid #e4e7ec;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(31,31,31,.04);transition:transform .16s ease-out,box-shadow .16s ease-out,border-color .16s ease-out;animation:rise .16s ease-out both}
.card:nth-child(2){animation-delay:.05s}.card:nth-child(3){animation-delay:.1s}.card:nth-child(n+4){animation-delay:.15s}
.card:hover{transform:translateY(-2px);border-color:#d0d5dd;box-shadow:0 2px 4px rgba(31,31,31,.06),0 12px 24px rgba(31,31,31,.10)}
.pic{position:relative;display:block;aspect-ratio:4/3;overflow:hidden;background:#f3f4f6}
.pic:before{content:"";position:absolute;inset:0;background:var(--c);opacity:.1}
.pic:after{content:attr(data-initial);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:var(--c);opacity:.7}
.pic img{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.02);transition:opacity .16s ease-out,transform .32s ease-out}
.pic.ok img{opacity:1;transform:none}
.card:hover .pic.ok img{transform:scale(1.04)}
.cb{display:flex;flex-direction:column;gap:2px;flex:1;padding:10px 12px 12px}
.ct{font-weight:600;font-size:14px;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cp{font-size:13px;line-height:18px;color:#5d6470;font-variant-numeric:tabular-nums}
.cm{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:10px;font-size:13px;font-weight:600}
.go{width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:var(--c);color:var(--on-c);transition:transform .16s ease-out}
.go svg{width:14px;height:14px}
.card:hover .go{transform:translateX(2px)}
.cnav{position:absolute;top:calc(50% - 20px);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e4e7ec;box-shadow:0 4px 12px rgba(31,31,31,.12);color:#1f1f1f;opacity:0;transition:opacity .12s ease-out}
.cnav svg{width:16px;height:16px}
.cnav.prev{left:8px}.cnav.prev svg{transform:rotate(180deg)}
.cnav.next{right:8px}
.carousel:hover .cnav,.cnav:focus-visible{opacity:1}
.cnav[hidden]{display:none}
.sugg{align-self:flex-end;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:88%;margin-top:4px}
.sg{display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:7px 10px 7px 12px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;font-size:13px;font-weight:500;line-height:18px;text-align:left;box-shadow:0 1px 2px rgba(31,31,31,.04);transition:border-color .12s ease-out,background .12s ease-out;animation:rise .16s ease-out both}
.sg:nth-child(2){animation-delay:.05s}.sg:nth-child(3){animation-delay:.1s}.sg:nth-child(4){animation-delay:.15s}
.sg span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg svg{width:16px;height:16px;color:#5d6470;transition:transform .12s ease-out,color .12s ease-out}
.sg.down svg{transform:rotate(90deg)}
.sg.link{border-color:var(--c)}
.sg:hover{border-color:var(--c);background:#f8f9fb}
.sg:hover svg{color:#1f1f1f;transform:translateX(2px)}
.sg.down:hover svg{transform:rotate(90deg) translateX(2px)}
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
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media (max-width:640px){
 .panel{left:0!important;right:0!important;top:0;bottom:0;width:100%;height:100%;border-radius:0;border:0;animation:none}
 .root.open .bubble{display:none}
}
@media (pointer:coarse){.hbtn,.ibtn,.send{width:44px;height:44px}.send.text{height:44px}.sg{min-height:44px}.cnav{display:none}}
@media (prefers-reduced-motion:reduce){
 .panel{animation:none}.bubble,.bubble:hover{transition:none;transform:none}.typing i{animation:none;opacity:.6}
 .card,.sg{animation:none;transition:none}.card:hover,.card:hover .go,.card:hover .pic.ok img{transform:none}.pic img{transition:none}
}
`;
