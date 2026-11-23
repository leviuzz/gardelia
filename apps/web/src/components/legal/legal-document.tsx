import { TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { Lexer, type Token, type Tokens } from 'marked';
import { Fragment, type ReactNode } from 'react';
import { legalRoutes } from '@/lib/routes';

/**
 * Un documento legale di `docs/legal/` (markdown) come pagina (ADR-068). I token di `marked`
 * diventano elementi React: niente HTML iniettato. I collegamenti fra i documenti (`./x.md`) portano
 * alle pagine dell'app; il riquadro iniziale ("BORRADOR…") si mostra come avviso.
 */

const DOCUMENT_LINKS: Readonly<Record<string, string>> = {
  './aviso-de-privacidad.md': legalRoutes.privacy,
  './terminos-y-condiciones.md': legalRoutes.terms,
  './terminos-compradores.md': legalRoutes.buyerTerms,
};

function inline(tokens: readonly Token[] | undefined, key = 'i'): ReactNode {
  if (!tokens) return null;
  return tokens.map((token, index) => {
    const id = `${key}-${index}`;
    switch (token.type) {
      case 'strong':
        return <strong key={id}>{inline((token as Tokens.Strong).tokens, id)}</strong>;
      case 'em':
        return <em key={id}>{inline((token as Tokens.Em).tokens, id)}</em>;
      case 'codespan':
        return (
          <code key={id} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
            {(token as Tokens.Codespan).text}
          </code>
        );
      case 'link': {
        const link = token as Tokens.Link;
        const href = DOCUMENT_LINKS[link.href] ?? link.href;
        const content = inline(link.tokens, id);
        return href.startsWith('/') ? (
          <Link key={id} href={href} className="font-medium text-primary hover:underline">
            {content}
          </Link>
        ) : (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            {content}
          </a>
        );
      }
      case 'br':
        return <br key={id} />;
      case 'text': {
        const text = token as Tokens.Text;
        return text.tokens ? (
          <Fragment key={id}>{inline(text.tokens, id)}</Fragment>
        ) : (
          <Fragment key={id}>{text.text}</Fragment>
        );
      }
      case 'escape':
        return <Fragment key={id}>{(token as Tokens.Escape).text}</Fragment>;
      default:
        // HTML o altro non previsto: si mostra come testo, mai interpretato.
        return <Fragment key={id}>{'text' in token ? String(token.text) : ''}</Fragment>;
    }
  });
}

function block(token: Token, id: string): ReactNode {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      if (heading.depth === 1) {
        return (
          <h1 key={id} className="font-display text-3xl font-semibold tracking-tight">
            {inline(heading.tokens, id)}
          </h1>
        );
      }
      if (heading.depth === 2) {
        return (
          <h2 key={id} className="mt-8 font-display text-xl font-semibold">
            {inline(heading.tokens, id)}
          </h2>
        );
      }
      return (
        <h3 key={id} className="mt-5 font-semibold">
          {inline(heading.tokens, id)}
        </h3>
      );
    }
    case 'paragraph':
      return (
        <p key={id} className="leading-relaxed">
          {inline((token as Tokens.Paragraph).tokens, id)}
        </p>
      );
    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={`${id}-${index}`} className="pl-1">
          {item.tokens.map((child, childIndex) =>
            child.type === 'text' ? (
              <Fragment key={`${id}-${index}-${childIndex}`}>
                {inline((child as Tokens.Text).tokens ?? [child], `${id}-${index}-${childIndex}`)}
              </Fragment>
            ) : (
              block(child, `${id}-${index}-${childIndex}`)
            ),
          )}
        </li>
      ));
      return list.ordered ? (
        <ol key={id} className="list-decimal space-y-1.5 pl-6 leading-relaxed">
          {items}
        </ol>
      ) : (
        <ul key={id} className="list-disc space-y-1.5 pl-6 leading-relaxed">
          {items}
        </ul>
      );
    }
    case 'blockquote':
      return (
        <div
          key={id}
          role="note"
          className="flex gap-3 rounded-xl bg-warning-soft p-4 text-sm text-[oklch(0.38_0.09_65)]"
        >
          <TriangleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            {(token as Tokens.Blockquote).tokens.map((child, index) =>
              block(child, `${id}-${index}`),
            )}
          </div>
        </div>
      );
    case 'table': {
      const table = token as Tokens.Table;
      return (
        <div key={id} className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {table.header.map((cell, index) => (
                  <th key={`${id}-h-${index}`} className="px-3 py-2 font-medium">
                    {inline(cell.tokens, `${id}-h-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {table.rows.map((row, rowIndex) => (
                <tr key={`${id}-r-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${id}-r-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
                      {inline(cell.tokens, `${id}-r-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'hr':
      return <hr key={id} className="my-6" />;
    case 'space':
      return null;
    default:
      return 'text' in token ? (
        <p key={id} className="leading-relaxed">
          {String(token.text)}
        </p>
      ) : null;
  }
}

export function LegalDocument({ markdown }: { readonly markdown: string }) {
  const tokens = Lexer.lex(markdown, { gfm: true });
  return (
    <article className="space-y-4">
      {tokens.map((token, index) => block(token, `b${index}`))}
    </article>
  );
}

/** Il titolo del documento (la prima intestazione), per i metadati della pagina. */
export function legalTitle(markdown: string): string {
  const heading = Lexer.lex(markdown).find(
    (token): token is Tokens.Heading => token.type === 'heading' && token.depth === 1,
  );
  return heading?.text ?? '';
}
