import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Calendar, MapPin } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';

export default function NewsDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        const res = await fetch(`/api/news-manager/articles/${id}`);
        const data = await res.json();
        if (data.data) {
          setArticle(data.data);
        }
      } catch (error) {
        console.error('Error fetching article', error);
      } finally {
        setLoading(false);
      }
    };
    fetchArticle();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center p-8">
        <div className="w-8 h-8 border-4 border-brand-300 border-t-brand-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] p-16">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Không tìm thấy bài viết</h2>
        <Link to="/manage-wp" className="mt-4 text-brand-500 hover:underline flex items-center gap-2">
          <ArrowLeft size={16} /> Quay lại
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full">
      <Link to="/manage-wp" className="inline-flex items-center gap-2 text-gray-500 hover:text-brand-500 mb-6 transition-colors font-medium">
        <ArrowLeft size={16} />
        <span className="text-sm">Quay lại danh sách</span>
      </Link>

      <article className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-white/[0.05] overflow-hidden">
        {article.thumbnailUrl && (
          <div className="w-full h-[400px] overflow-hidden bg-gray-100 dark:bg-gray-800">
            <img src={article.thumbnailUrl} alt={article.title} className="w-full h-full object-cover" />
          </div>
        )}
        
        <div className="p-8 md:p-12">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white leading-tight mb-6">
            {article.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-8 pb-8 border-b border-gray-100 dark:border-white/[0.05]">
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5 rounded-full">
              <Calendar size={16} />
              <span>{new Date(article.publishDate || article.createdAt).toLocaleDateString('vi-VN')}</span>
            </div>
            {article.source && (
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5 rounded-full">
                <MapPin size={16} />
                <span className="font-medium">{article.source}</span>
              </div>
            )}
            {article.url && (
              <a 
                href={article.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-brand-500 hover:text-brand-600 bg-brand-50 dark:bg-brand-500/10 px-3 py-1.5 rounded-full transition-colors font-medium"
              >
                <ExternalLink size={16} />
                <span>Nguồn gốc</span>
              </a>
            )}
          </div>

          {article.summary && (
            <div className="text-lg text-gray-600 dark:text-gray-300 font-medium leading-relaxed italic border-l-4 border-brand-500 pl-6 mb-8">
              {article.summary}
            </div>
          )}

          <div className="prose prose-lg dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline">
            {article.content ? (
              <ReactMarkdown remarkPlugins={[remarkBreaks]}>{article.content}</ReactMarkdown>
            ) : (
              <p className="text-gray-500 italic">Nội dung chưa được phân tích hoặc không khả dụng.</p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
