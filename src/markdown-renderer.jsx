import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

const plugins = [remarkGfm, remarkBreaks];

export default function MarkdownRenderer({ children, components }) {
  return <Markdown remarkPlugins={plugins} components={components}>{children}</Markdown>;
}
