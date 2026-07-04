/**
 * Sonido de notificación de invitación (estilo Steam), sintetizado con WebAudio
 * para no depender de ningún asset binario. Es un doble "bloop" ascendente:
 * dos notas cortas encadenadas, suaves, que se reconocen sin ser molestas.
 *
 * Autoplay: los navegadores arrancan el AudioContext en estado `suspended` y
 * solo permiten `resume()` DENTRO de un gesto del usuario. La invitación llega
 * por SSE/DM (sin gesto), así que si esperáramos a ese momento el sonido nunca
 * suena. Por eso "cebamos" el contexto en el primer click/tecla/toque de la
 * sesión (ver `armInviteSound`): a partir de ahí queda `running` y el chime ya
 * puede sonar cuando llegue la invitación.
 */

let ctx: AudioContext | null = null;
let armed = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    return ctx;
  } catch {
    return null;
  }
}

/** Programa una nota senoidal con envolvente suave (ataque + caída). */
function tone(ac: AudioContext, freq: number, start: number, dur: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const peak = 0.14;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/**
 * Desbloquea el AudioContext dentro de un gesto del usuario. Crea el contexto,
 * lo reanuda y dispara un blip mudo (algunos navegadores —iOS Safari— exigen que
 * suene algo en el mismo gesto para considerarlo desbloqueado). Best-effort.
 */
function unlock(): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume();
    // Blip a volumen ~0: no se oye, pero "arranca" el pipeline de audio.
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.02);
  } catch {
    /* no-op */
  }
}

/**
 * Registra —una sola vez— la escucha del primer gesto del usuario para cebar el
 * audio. Llamalo al montar la app; es idempotente y se autolimpia tras el primer
 * gesto. Sin esto, el chime de invitación no suena hasta que el usuario haya
 * interactuado con la página.
 */
export function armInviteSound(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const onGesture = () => {
    unlock();
    for (const e of events) window.removeEventListener(e, onGesture);
  };
  for (const e of events) {
    // `capture` + `passive`: no interfiere con ningún otro handler de la app.
    window.addEventListener(e, onGesture, { capture: true, passive: true });
  }
}

/** Reproduce el chime de invitación. Best-effort: nunca lanza. */
export function playInviteSound(): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume();
    const t = ac.currentTime + 0.01;
    // Dos notas ascendentes (La5 → Do#6): el "bloop bloop" de aviso.
    tone(ac, 880, t, 0.12);
    tone(ac, 1108.73, t + 0.11, 0.16);
  } catch {
    /* audio bloqueado o no disponible: la notificación visual alcanza */
  }
}
