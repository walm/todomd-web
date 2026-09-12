import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { attachmentUrl } from '@/lib/attach'
import { cn } from '@/lib/utils'

export interface MarkdownProps {
  children: string
  className?: string
  /** The project, and where its attachments live, so a link to an attached
   *  file loads through the API rather than pointing at a path on disk. */
  project?: string
  attachments?: string
}

/** Descriptions and comments are verbatim markdown from a file that anyone —
 *  including an agent — can write to, so it is rendered sanitized. Import
 *  this through markdown-lazy so the board doesn't carry the parser. */
export function Markdown({ children, className, project, attachments }: MarkdownProps) {
  return (
    <div
      className={cn(
        'text-sm leading-relaxed break-words',
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5',
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_a]:underline [&_a]:underline-offset-2',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_table]:my-2 [&_table]:w-full [&_table]:text-left',
        '[&_th]:border-b [&_th]:py-1 [&_th]:pr-3 [&_td]:py-1 [&_td]:pr-3',
        '[&_hr]:my-3 [&_hr]:border-t',
        '[&_img]:my-2 [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Sanitize first, then highlight: the `hljs-*` spans are derived from
        // the already-cleaned text, so they can't smuggle anything through.
        // Fences without a language are left alone rather than guessed at.
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        // Runs after sanitizing, on URLs that already passed it. Anything
        // that is not an attachment gets the default, which drops unsafe
        // protocols.
        urlTransform={(url) =>
          attachmentUrl(url, project ?? '', attachments) ?? defaultUrlTransform(url)
        }
        components={{
          // A screenshot is read at full size: it opens in a tab of its own.
          img: ({ node: _node, src, alt, ...props }) => (
            <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer">
              <img src={src} alt={alt} loading="lazy" {...props} />
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
