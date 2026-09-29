/* Birthday envelope — pops open in the middle of the home page for her birthday week,
   then points to /birthday/. Self-contained: injects its own styles and markup,
   and does nothing once the week is over. */

(() => {
	// Shows until 2026-10-07 00:00 America/New_York (EDT = UTC-4)
	const END = Date.UTC(2026, 9, 7, 4, 0, 0);
	if (Date.now() >= END) return;

	const SEEN = 'ff-bday-letter-seen';
	try {
		if (sessionStorage.getItem(SEEN)) return;
		sessionStorage.setItem(SEEN, '1');
	} catch (e) { /* private mode: just show it */ }

	const font = document.createElement('link');
	font.rel = 'stylesheet';
	font.href = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap';
	document.head.appendChild(font);

	const css = `
	.bl-overlay {
		position: fixed; inset: 0; z-index: 10000;
		display: grid; place-items: center;
		padding: 16px;
		background: rgba(90, 61, 54, 0.3);
		-webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
		animation: bl-fade 0.35s ease both;
		-webkit-tap-highlight-color: transparent;
	}
	.bl-overlay.bl-bye { animation: bl-fade 0.3s ease reverse both; }
	@keyframes bl-fade { from { opacity: 0; } }
	.bl-close {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 14px); right: max(14px, env(safe-area-inset-right));
		width: 44px; height: 44px; border-radius: 50%;
		border: 0; background: rgba(255, 255, 255, 0.92); color: #8a6a60;
		font: 700 24px/1 system-ui, sans-serif; cursor: pointer;
		box-shadow: 0 4px 14px rgba(90, 61, 54, 0.18);
	}
	.bl-stage { --w: min(84vw, 400px); position: relative; width: var(--w); }
	.bl-env {
		position: relative; width: var(--w); height: calc(var(--w) * 0.7);
		animation: bl-drop 0.9s cubic-bezier(0.25, 1.4, 0.45, 1) both;
		transition: transform 0.6s ease, opacity 0.5s ease;
	}
	@keyframes bl-drop {
		0% { transform: translateY(-70vh) rotate(-8deg); }
		70% { transform: translateY(0) rotate(2deg); }
		85% { transform: rotate(-1.5deg); }
		100% { transform: none; }
	}
	.bl-back, .bl-front, .bl-bottom, .bl-flap { position: absolute; inset: 0; border-radius: 14px; }
	.bl-back { background: #f5a9bb; box-shadow: 0 18px 40px rgba(200, 90, 120, 0.3); z-index: 1; }
	.bl-front { background: #ffc6d3; clip-path: polygon(0 0, 50% 54%, 100% 0, 100% 100%, 0 100%); z-index: 3; }
	.bl-bottom { background: #ffb6c7; clip-path: polygon(0 100%, 50% 46%, 100% 100%); z-index: 3; }
	.bl-flap {
		background: linear-gradient(#ff9fb5, #ffb3c5);
		clip-path: polygon(0 0, 100% 0, 50% 58%);
		transform-origin: 50% 0;
		transform: perspective(900px) rotateX(0deg);
		transition: transform 0.6s ease;
		z-index: 4;
	}
	.bl-seal {
		position: absolute; left: 50%; top: 54%; z-index: 5;
		width: 46px; height: 46px; margin: -23px 0 0 -23px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, #f28ea6, #d95c7c);
		box-shadow: 0 3px 8px rgba(160, 50, 80, 0.35), inset 0 0 0 3px rgba(255, 255, 255, 0.25);
		display: grid; place-items: center;
		transition: transform 0.35s ease, opacity 0.3s ease;
	}
	.bl-seal svg { width: 22px; height: 22px; fill: #fff; }
	.bl-letter {
		position: absolute; left: 5%; top: 6px; z-index: 2;
		width: 90%; height: calc(var(--w) * 0.7 - 12px);
		background: #fffdf9; border-radius: 12px;
		box-shadow: 0 6px 20px rgba(200, 120, 110, 0.18);
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: calc(var(--w) * 0.012); padding: calc(var(--w) * 0.035) 14px; text-align: center;
		color: #5a3d36;
		transition: transform 0.7s cubic-bezier(0.3, 1.2, 0.5, 1);
	}
	.bl-letter::before { content: ""; position: absolute; inset: 6px; border: 2px dashed #fbd9df; border-radius: 9px; pointer-events: none; }
	.bl-letter p { margin: 0; }
	.bl-face { width: calc(var(--w) * 0.12); height: calc(var(--w) * 0.11); }
	.bl-hi { font: 800 calc(var(--w) * 0.045)/1.3 "Nunito", "PingFang SC", sans-serif; color: #8a6a60; }
	.bl-big { font: 400 calc(var(--w) * 0.095)/1.15 "ZCOOL KuaiLe", "PingFang SC", sans-serif; color: #e8728f; }
	.bl-miss { font: 400 calc(var(--w) * 0.062)/1.3 "ZCOOL KuaiLe", "PingFang SC", sans-serif; color: #5a3d36; }
	.bl-more {
		position: relative; z-index: 1;
		margin-top: calc(var(--w) * 0.025); padding: calc(var(--w) * 0.026) calc(var(--w) * 0.06); border-radius: 999px;
		background: linear-gradient(135deg, #ffa9bd, #e8728f); color: #fff;
		font: 800 calc(var(--w) * 0.045)/1.2 "Nunito", "PingFang SC", sans-serif; text-decoration: none;
		box-shadow: 0 4px 0 #d0587a, 0 8px 16px rgba(232, 114, 143, 0.3);
	}
	.bl-more:active { transform: translateY(3px); box-shadow: 0 1px 0 #d0587a; }
	.bl-hearts { position: absolute; inset: 0; pointer-events: none; z-index: 7; }
	.bl-hearts svg { position: absolute; bottom: 40%; width: 18px; height: 18px; fill: #ff9fb5; opacity: 0; }
	.bl-read .bl-hearts svg { animation: bl-rise 2.4s ease-out forwards; }
	@keyframes bl-rise { 0% { opacity: 0; transform: translateY(0) scale(0.6); } 20% { opacity: 0.9; } 100% { opacity: 0; transform: translateY(-46vh) scale(1.1); } }

	.bl-open .bl-seal { transform: scale(1.4); opacity: 0; }
	.bl-open .bl-flap { transform: perspective(900px) rotateX(180deg); }
	.bl-flipped .bl-flap { z-index: 0; }
	.bl-rise .bl-letter { transform: translateY(calc(-100% - 12px)); }
	.bl-front-letter .bl-letter { z-index: 6; }
	.bl-read .bl-letter { transform: translateY(-4%) scale(1.12); }
	.bl-read .bl-env-parts { transform: translateY(45%); opacity: 0; }
	.bl-env-parts { position: absolute; inset: 0; transition: transform 0.6s ease, opacity 0.5s ease; }

	@media (prefers-reduced-motion: reduce) {
		.bl-overlay *, .bl-overlay { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
	}`;
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);

	const heart = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.2 1.7-2 3.2-3.2 5.3-3.2 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>';
	const bear = `<svg class="bl-face" viewBox="26 20 148 134" aria-hidden="true">
		<circle cx="52" cy="48" r="23" fill="#b8845a"/><circle cx="52" cy="48" r="12" fill="#ebbd98"/>
		<circle cx="148" cy="48" r="23" fill="#b8845a"/><circle cx="148" cy="48" r="12" fill="#ebbd98"/>
		<ellipse cx="100" cy="94" rx="64" ry="56" fill="#c8956a"/>
		<ellipse cx="100" cy="115" rx="27" ry="20" fill="#f5e0c9"/>
		<ellipse cx="100" cy="106" rx="9" ry="6" fill="#4a3228"/>
		<path d="M100 110 v4 M100 114 q-6 7 -11 2 M100 114 q6 7 11 2" stroke="#4a3228" stroke-width="2.8" fill="none" stroke-linecap="round"/>
		<ellipse cx="76" cy="88" rx="6" ry="7.5" fill="#3a2a24"/><ellipse cx="124" cy="88" rx="6" ry="7.5" fill="#3a2a24"/>
		<circle cx="78.2" cy="85" r="2.3" fill="#fff"/><circle cx="126.2" cy="85" r="2.3" fill="#fff"/>
		<ellipse cx="62" cy="110" rx="11" ry="6.5" fill="#f59aa7" opacity=".6"/><ellipse cx="138" cy="110" rx="11" ry="6.5" fill="#f59aa7" opacity=".6"/>
	</svg>`;

	const overlay = document.createElement('div');
	overlay.className = 'bl-overlay';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', '一封生日信');
	overlay.innerHTML = `
		<button class="bl-close" type="button" aria-label="关闭">×</button>
		<div class="bl-stage">
			<div class="bl-hearts">${[8, 22, 38, 55, 70, 86].map((x, i) => heart.replace('<svg', `<svg style="left:${x}%;animation-delay:${i * 0.18}s"`)).join('')}</div>
			<div class="bl-env">
				<div class="bl-env-parts">
					<div class="bl-back"></div>
					<div class="bl-front"></div>
					<div class="bl-bottom"></div>
					<div class="bl-flap"></div>
					<div class="bl-seal">${heart}</div>
				</div>
				<div class="bl-letter">
					${bear}
					<p class="bl-hi">小朋友</p>
					<p class="bl-big">生日快乐！</p>
					<p class="bl-miss">哥哥想你啦 ♥&#xFE0E;</p>
					<a class="bl-more" href="birthday/">点击查看更多 →</a>
				</div>
			</div>
		</div>`;

	const root = document.documentElement;
	const prevOverflow = root.style.overflow;
	const close = () => {
		overlay.classList.add('bl-bye');
		setTimeout(() => { overlay.remove(); root.style.overflow = prevOverflow; }, 300);
	};
	overlay.querySelector('.bl-close').addEventListener('click', close);

	const mount = () => {
		document.body.appendChild(overlay);
		root.style.overflow = 'hidden';
		const stage = overlay.querySelector('.bl-stage');
		const env = overlay.querySelector('.bl-env');
		const steps = [
			[1000, () => env.classList.add('bl-open')],
			[1300, () => env.classList.add('bl-flipped')],
			[1650, () => env.classList.add('bl-rise')],
			[2400, () => env.classList.add('bl-front-letter')],
			[2450, () => { env.classList.add('bl-read'); stage.classList.add('bl-read'); }],
		];
		steps.forEach(([t, fn]) => setTimeout(fn, t));
	};
	if (document.body) mount();
	else document.addEventListener('DOMContentLoaded', mount);
})();
