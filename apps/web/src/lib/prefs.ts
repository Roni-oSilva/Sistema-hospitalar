/**
 * Preferências LOCAIS deste computador (conveniência, nunca dados clínicos):
 * identificação do computador, consultório escolhido pelo médico e tamanho do texto.
 * localStorage pode estar indisponível (janela privada, política do navegador) — tudo é tolerante a falhas.
 */
const KEYS = { device: 'hosp.deviceLabel', room: 'hosp.roomId', scale: 'hosp.textScale', sound: 'hosp.panelSound' } as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento local: a preferência vale só nesta tela */
  }
}

export const prefs = {
  deviceLabel: () => read(KEYS.device),
  setDeviceLabel: (v: string | null) => write(KEYS.device, v),
  roomId: () => read(KEYS.room),
  setRoomId: (v: string | null) => write(KEYS.room, v),
  textScale: (): 'md' | 'lg' | 'xl' => {
    const v = read(KEYS.scale);
    return v === 'lg' || v === 'xl' ? v : 'md';
  },
  setTextScale: (v: 'md' | 'lg' | 'xl') => {
    write(KEYS.scale, v);
    document.documentElement.dataset.textScale = v;
  },
  panelSound: () => read(KEYS.sound) === '1',
  setPanelSound: (on: boolean) => write(KEYS.sound, on ? '1' : '0'),
};
