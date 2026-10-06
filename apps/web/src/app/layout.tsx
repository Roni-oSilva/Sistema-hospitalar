import type { Metadata, Viewport } from 'next';
// fontes empacotadas localmente (funcionam na intranet do hospital, sem Google Fonts)
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/montserrat';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Atendimento — Hospital Municipal de Ulianópolis', template: '%s · HMU Atendimento' },
  description: 'Sistema digital de atendimento do Hospital Municipal de Ulianópolis',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f3d7d' };

// aplica o tamanho de texto escolhido ANTES da pintura (evita "pulo" de layout)
const textScaleScript = `try{var s=localStorage.getItem('hosp.textScale');if(s==='lg'||s==='xl')document.documentElement.dataset.textScale=s}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: textScaleScript }} />
      </head>
      <body>
        <a href="#conteudo" className="sr-only z-50 rounded bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
          Pular para o conteúdo
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
