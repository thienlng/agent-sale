/**
 * Widget CSS, injected into the shadow root, after the Rapiz brand (v2, "Enterprise Challenger"):
 * light surfaces, charcoal text, the site's colour only on actions and accents, radius 8px control
 * / 12px card / 12px message / 14px launcher / 16px window, compact on desktop (14px inputs;
 * 16px and 44px targets on touch, so iOS does not zoom), Inter when the page has it, short
 * ease-out motion. `--c` is the site's colour, `--on-c` the text on it (charcoal or white, see
 * `onColor`), `--tint` and `--wash` the colour mixed into white (user messages, the featured card),
 * `--av` the avatar picture and `--ini` its fallback letter.
 */
export const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.root{font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1f1f1f;-webkit-font-smoothing:antialiased}
.root.left .bubble,.root.left .panel{left:20px}
.root.right .bubble,.root.right .panel{right:20px}
.root.left .tip{left:84px}.root.right .tip{right:84px}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;padding:0}
svg{width:20px;height:20px;fill:currentColor;flex:none}
button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid #b54708;outline-offset:2px}
.bubble{position:fixed;bottom:20px;width:52px;height:52px;border-radius:14px;background:var(--c);color:var(--on-c);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(31,31,31,.12),0 10px 28px rgba(31,31,31,.18);transition:transform .15s ease-out,box-shadow .15s ease-out,background .15s ease-out}
.bubble.mark{background:#1f1f1f}
.bubble img{width:28px;height:28px;object-fit:contain}
.bubble svg{width:22px;height:22px}
.bubble:hover{transform:translateY(-2px);box-shadow:0 4px 8px rgba(31,31,31,.14),0 14px 32px rgba(31,31,31,.2)}
.bubble:active{transform:none;box-shadow:0 1px 2px rgba(31,31,31,.16)}
.root.open .bubble{transform:none}
.dot{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:#12b76a;box-shadow:0 0 0 2px #fff}
.bubble.unread .dot{display:none}
.badge{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#d92d20;color:#fff;font-size:12px;font-weight:600;line-height:20px;text-align:center;box-shadow:0 0 0 2px #fff}
.badge[hidden],.tip[hidden]{display:none}
.tip{position:fixed;bottom:31px;padding:6px 12px;border-radius:8px;background:#fff;border:1px solid #e5e5e5;font-size:13px;font-weight:500;line-height:18px;white-space:nowrap;box-shadow:0 4px 16px rgba(31,31,31,.12);opacity:0;transform:translateX(4px);pointer-events:none;transition:opacity .15s ease-out,transform .15s ease-out}
.bubble:hover+.tip,.bubble:focus-visible+.tip{opacity:1;transform:none}
.root.open .tip{display:none}
.panel{position:fixed;bottom:80px;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 100px));background:#fff;border-radius:16px;border:1px solid #e5e5e5;box-shadow:0 2px 6px rgba(31,31,31,.06),0 24px 56px rgba(31,31,31,.16);display:flex;flex-direction:column;overflow:hidden;animation:pop .2s ease-out}
.panel.out{animation:fade .15s ease-in forwards}
.panel[hidden]{display:none}
.head{position:relative;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px;background:#faf8f5;border-bottom:1px solid #e5e5e5;overflow:hidden}
.head:before{content:"";position:absolute;top:0;right:0;bottom:0;width:38%;background:var(--wash);clip-path:polygon(28% 0,100% 0,100% 100%,0 100%)}
.head .deco{position:absolute;top:50%;right:84px;width:36px;height:14px;margin-top:-7px;color:var(--c);opacity:.85}
.head>*{position:relative}
.logo{width:32px;height:32px;border-radius:8px;object-fit:contain;flex:none}
div.logo{display:flex;align-items:center;justify-content:center;background:var(--c);color:var(--on-c);font-weight:800;font-size:15px}
.title{flex:1;min-width:0}
.name{font-weight:700;font-size:15px;line-height:20px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:#6b7280}
.status:before{content:"";width:7px;height:7px;border-radius:50%;background:#12b76a}
.hbtn{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;background:#fff;border:1px solid #e5e5e5;color:#1f1f1f;transition:background .15s ease-out,border-color .15s ease-out}
.hbtn svg{width:14px;height:14px}
.hbtn:hover{background:#f4f4f4;border-color:#d4d4d4}
.lead{border-bottom:1px solid #e5e5e5;background:#fff}
.lead[hidden],.chip[hidden],form[hidden]{display:none}
.chip{display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;font-size:13px;font-weight:600;line-height:18px;text-align:left;transition:background .15s ease-out}
.chip:hover{background:#faf8f5}
.chip span:not(.ci){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip>svg{width:16px;height:16px;color:#6b7280;transition:transform .15s ease-out}
.chip:hover>svg{transform:translateX(2px);color:#1f1f1f}
.ci{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--wash);color:#1f1f1f}
.ci svg{width:13px;height:13px}
.list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fff;overscroll-behavior:contain}
.msg{position:relative;max-width:calc(100% - 40px);padding:8px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.agent,.typing{align-self:flex-start;margin-left:32px;background:#faf8f5;border:1px solid #ececec;border-top-left-radius:4px}
.msg.agent:before,.typing:before{content:var(--ini);position:absolute;left:-33px;top:-1px;width:24px;height:24px;border-radius:7px;border:1px solid #e5e5e5;background:#fff var(--av) center/15px no-repeat;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#1f1f1f}
.msg.customer{align-self:flex-end;background:var(--tint);border-top-right-radius:4px}
.msg.pending{opacity:.6}
.msg.failed{background:#fef3f2;color:#b42318;border:1px solid #fecdca;cursor:pointer}
.msg img{display:block;max-width:100%;max-height:240px;border-radius:8px}
.msg .note{display:block;font-size:12px;margin-top:4px;font-weight:500}
.carousel{position:relative;align-self:stretch;margin:-4px -14px 0}
.cards{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 14px;padding:2px 14px 8px;scrollbar-width:none;overscroll-behavior-x:contain}
.cards::-webkit-scrollbar{display:none}
.card{position:relative;flex:0 0 160px;scroll-snap-align:start;display:flex;flex-direction:column;text-align:left;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(31,31,31,.04);transition:transform .15s ease-out,box-shadow .15s ease-out,border-color .15s ease-out;animation:rise .16s ease-out both}
.card:nth-child(2){animation-delay:.05s}.card:nth-child(3){animation-delay:.1s}.card:nth-child(n+4){animation-delay:.15s}
.card:hover{transform:translateY(-2px);border-color:#d4d4d4;box-shadow:0 2px 4px rgba(31,31,31,.06),0 12px 24px rgba(31,31,31,.1)}
.card.plan{flex-basis:calc((100% - 8px)/2);min-width:156px;padding:12px 12px 12px;gap:4px}
.card.rec{background:var(--wash);border-color:var(--c)}
.card .sl{position:absolute;top:14px;right:10px;width:26px;height:10px;color:var(--c)}
.pic{position:relative;display:block;aspect-ratio:4/3;overflow:hidden;background:#f4f4f4}
.pic:before{content:"";position:absolute;inset:0;background:var(--c);opacity:.1}
.pic:after{content:attr(data-initial);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:var(--c);opacity:.7}
.pic img{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.02);transition:opacity .16s ease-out,transform .32s ease-out}
.pic.ok img{opacity:1;transform:none}
.card:hover .pic.ok img{transform:scale(1.04)}
.cb{display:flex;flex-direction:column;gap:2px;flex:1;padding:8px 10px 10px}
.ct{font-weight:600;font-size:13px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.plan .ct{font-weight:800;font-size:15px;line-height:20px;letter-spacing:-.01em;padding-right:30px}
.cs{font-size:12px;line-height:17px;color:#6b7280}
.cp{font-size:12px;line-height:17px;color:#6b7280;font-variant-numeric:tabular-nums}
.plan .cp{color:#1f1f1f;font-weight:600}
.hl{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:17px}
.hl li{display:flex;gap:6px}
.hl svg{width:14px;height:14px;margin-top:1px;color:#b54708}
.cm{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:8px;font-size:12px;font-weight:600}
.go{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--c);color:var(--on-c);transition:transform .15s ease-out}
.go svg,.cta svg{width:13px;height:13px}
.card:hover .go{transform:translateX(2px)}
.cta{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:auto;padding:6px 10px;border-radius:8px;border:1px solid #d4d4d4;background:#fff;font-size:12px;font-weight:600;line-height:18px}
.hl+.cta,.cs+.cta,.cp+.cta{margin-top:10px}
.rec .cta{background:var(--c);border-color:var(--c);color:var(--on-c)}
.card:hover .cta svg{transform:translateX(2px)}
.cnav{position:absolute;top:calc(50% - 18px);width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e5e5e5;box-shadow:0 4px 12px rgba(31,31,31,.12);color:#1f1f1f;opacity:0;transition:opacity .15s ease-out}
.cnav svg{width:14px;height:14px}
.cnav.prev{left:8px}.cnav.prev svg{transform:rotate(180deg)}
.cnav.next{right:8px}
.carousel:hover .cnav,.cnav:focus-visible{opacity:1}
.cnav[hidden]{display:none}
.sugg{display:flex;flex-wrap:wrap;gap:6px;margin:-2px 0 0 32px}
.sg{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:4px 10px 4px 8px;border-radius:999px;border:1px solid #e5e5e5;background:#fff;font-size:12.5px;font-weight:500;line-height:18px;text-align:left;transition:border-color .15s ease-out,background .15s ease-out;animation:rise .16s ease-out both}
.sg:nth-child(2){animation-delay:.05s}.sg:nth-child(3){animation-delay:.1s}.sg:nth-child(4){animation-delay:.15s}
.sg span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sg svg{width:13px;height:13px;color:#b54708}
.sg.down svg{transform:rotate(90deg)}
.sg:hover{border-color:var(--c);background:#faf8f5}
.typing{display:flex;gap:4px;padding:12px}
.typing[hidden]{display:none}
.typing i{width:6px;height:6px;border-radius:50%;background:#6b7280;animation:blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
.notice{padding:8px 16px;font-size:12px;line-height:16px;color:#b42318;background:#fef3f2;border-top:1px solid #fecdca}
.notice[hidden]{display:none}
form{padding:10px 14px 0;background:#fff}
.composer{border-top:1px solid #f0f0f0}
.field{display:flex;align-items:flex-end;gap:2px;padding:3px;border:1px solid #e5e5e5;border-radius:10px;background:#fff;transition:border-color .15s ease-out}
.field:focus-within{border-color:#1f1f1f}
textarea,input{flex:1;min-width:0;font:inherit;font-size:14px;line-height:20px;border:0;padding:5px 6px;resize:none;max-height:120px;color:#1f1f1f;background:transparent}
textarea::placeholder,input::placeholder{color:#6b7280;opacity:1}
textarea:focus,input:focus{outline:none}
.ibtn{width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex:none;color:#6b7280;transition:background .15s ease-out}
.ibtn svg,.send svg{width:17px;height:17px}
.ibtn:hover{background:#f4f4f4;color:#1f1f1f}
.send{width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--c);color:var(--on-c);transition:opacity .15s ease-out,transform .15s ease-out}
.send:hover:not(:disabled){transform:translateY(-1px)}
.send:disabled{opacity:.4;cursor:default}
.field[aria-busy=true] .send{opacity:.6;cursor:progress}
.foot{display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px 8px;font-size:11px;line-height:14px;color:#6b7280;background:#fff}
.foot svg{width:16px;height:7px;color:var(--c)}
.phoneform{display:flex;flex-direction:column;gap:6px;padding:10px 14px;background:#faf8f5;animation:rise .16s ease-out both}
.phead{display:flex;align-items:center;gap:8px}
.phead .hint{flex:1;min-width:0;margin:0;font-size:12.5px;font-weight:600;line-height:17px}
.phead .hbtn{width:24px;height:24px}
.phead .hbtn[hidden]{display:none}
.phoneform .field{align-items:center}
.phoneform input{height:30px}
.phoneform .err{font-size:12px;line-height:16px;color:#b42318;margin:0}
.phoneform .err[hidden]{display:none}
@keyframes pop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes fade{to{opacity:0;transform:translateY(4px)}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
@media (max-width:640px){
 .panel{left:0!important;right:0!important;top:0;bottom:0;width:100%;height:100%;border-radius:0;border:0;animation:none}
 .panel.out{animation:none}
 .head{padding-top:max(10px,env(safe-area-inset-top))}
 .foot{padding-bottom:max(8px,env(safe-area-inset-bottom))}
 .head .deco{display:none}
 .root.open .bubble{display:none}
}
@media (pointer:coarse){textarea,input{font-size:16px}.hbtn,.ibtn,.send{width:44px;height:44px}.chip,.sg{min-height:44px}.cnav,.tip{display:none}}
@media (prefers-reduced-motion:reduce){
 .panel,.panel.out{animation:none}.bubble,.bubble:hover,.send{transition:none;transform:none}.typing i{animation:none;opacity:.6}
 .card,.sg,.phoneform{animation:none;transition:none}.card:hover,.card:hover .go,.card:hover .pic.ok img{transform:none}.pic img,.tip{transition:none}
}
`;
