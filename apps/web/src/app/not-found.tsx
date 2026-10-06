import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="conteudo" className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="font-mono text-6xl font-bold text-ink-3">404</p>
        <h1 className="mt-2 text-2xl font-bold">Página não encontrada</h1>
        <p className="mt-1 text-ink-3">O endereço pode ter mudado ou você não tem acesso a ele.</p>
        <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-accent px-5 font-semibold text-white">
          Ir para a minha tela inicial
        </Link>
      </div>
    </main>
  );
}
