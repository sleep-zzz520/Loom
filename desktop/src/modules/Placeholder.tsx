import { Sparkles } from 'lucide-react';

export default function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="module-page placeholder">
      <div className="placeholder-icon">
        <Sparkles size={18} />
      </div>
      <h2 className="page-title">{title}</h2>
      <p className="placeholder-hint">{hint}</p>
    </section>
  );
}
