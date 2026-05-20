/**
 * Exemple SinwanJS — Server-Side Rendering avec le serveur HTTP
 *
 * Demonstrates:
 * - Sinwan app with JSX pages rendered server-side
 * - c.render() for full page rendering
 * - c.streamRender() for progressive streaming SSR
 * - Route params and data fetching
 *
 * Run: bun run src/pages/example-server.tsx
 */

import { cc, For } from "sinwan/component";

// =============================================================================
// LAYOUT
// =============================================================================

interface LayoutProps {
  title: string;
  description?: string;
}

const Layout = cc<LayoutProps>(({ title, description, children }) => (
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — SinwanJS</title>
      {description && <meta name="description" content={description} />}
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #1a1a1a; background: #fafafa; }
        .container { max-width: 800px; margin: 0 auto; padding: 0 1.5rem; }
        header { background: #1a1a1a; color: white; padding: 1rem 0; }
        header a { color: white; text-decoration: none; font-weight: bold; font-size: 1.25rem; }
        nav { margin-top: 0.5rem; }
        nav a { color: #ccc; text-decoration: none; margin-right: 1rem; font-size: 0.9rem; }
        nav a:hover { color: white; }
        main { padding: 2rem 0; }
        h1 { font-size: 2rem; margin-bottom: 1rem; }
        .card { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
        .card h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
        .card h2 a { color: #2563eb; text-decoration: none; }
        .card p { color: #555; font-size: 0.95rem; }
        .meta { font-size: 0.8rem; color: #888; margin-bottom: 0.5rem; }
        .tag { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-right: 0.25rem; }
        footer { border-top: 1px solid #e0e0e0; padding: 1.5rem 0; margin-top: 2rem; text-align: center; color: #888; font-size: 0.85rem; }
        .post-content { margin-top: 1.5rem; line-height: 1.8; }
        .post-content p { margin-bottom: 1rem; }
      `}</style>
    </head>
    <body>
      <header>
        <div class="container">
          <a href="/">SinwanJS Blog</a>
          <nav>
            <a href="/">Accueil</a>
            <a href="/blog">Articles</a>
            <a href="/about">À propos</a>
          </nav>
        </div>
      </header>
      <main>
        <div class="container">{children}</div>
      </main>
      <footer>
        <div class="container">
          <p>
            © {new Date().getFullYear()} SinwanJS — Server-Side Rendering
            Example
          </p>
        </div>
      </footer>
    </body>
    <script>{`console.log("test")`}</script>
  </html>
));

// =============================================================================
// COMPONENTS
// =============================================================================

interface ArticleCardProps {
  title: string;
  excerpt: string;
  slug: string;
  date: string;
  author: string;
  tags: string[];
}

const ArticleCard = cc<ArticleCardProps>(
  ({ title, excerpt, slug, date, author, tags }) => (
    <div class="card">
      <div class="meta">
        {date} — {author}
      </div>
      <h2>
        <a href={`/blog/${slug}`}>{title}</a>
      </h2>
      <p>{excerpt}</p>
      {tags.length > 0 && (
        <div style="margin-top: 0.5rem">
          {tags.map((tag) => (
            <span class="tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
  ),
);

// =============================================================================
// PAGES
// =============================================================================

// --- Home Page ---
interface HomeData {
  message: string;
}

export const HomePage = cc<HomeData>(({ message }) => (
  <Layout title="Accueil" description="Bienvenue sur le blog SinwanJS">
    <h1>Bienvenue!</h1>
    <p style="font-size: 1.1rem; color: #555; margin-bottom: 1.5rem">
      {message}
    </p>
    <div class="card">
      <h2>Rendu côté serveur</h2>
      <p>
        Cette page est rendue entièrement côté serveur avec SinwanJS et JSX.
      </p>
    </div>
    <div class="card">
      <h2>Streaming SSR</h2>
      <p>
        Visitez{" "}
        <a href="/blog" style="color: #2563eb">
          /blog
        </a>{" "}
        pour voir le streaming SSR en action.
      </p>
    </div>
  </Layout>
));

// --- Blog List Page ---
interface BlogListData {
  posts: {
    id: number;
    title: string;
    excerpt: string;
    slug: string;
    date: string;
    author: string;
    tags: string[];
  }[];
}

export const BlogListPage = cc<BlogListData>(({ posts }) => (
  <Layout title="Articles" description="Tous les articles du blog">
    <h1>Articles</h1>
    <p style="color: #555; margin-bottom: 1.5rem">
      {posts.length} article{posts.length > 1 ? "s" : ""} disponible
      {posts.length > 1 ? "s" : ""}
    </p>
    <For each={posts}>
      {(post) => (
        <ArticleCard
          title={post.title}
          excerpt={post.excerpt}
          slug={post.slug}
          date={post.date}
          author={post.author}
          tags={post.tags}
        />
      )}
    </For>
  </Layout>
));

// --- Blog Post Page ---
interface BlogPostData {
  post: {
    title: string;
    content: string;
    date: string;
    author: string;
    tags: string[];
  };
}

export const BlogPostPage = cc<BlogPostData>(({ post }) => (
  <Layout title={post.title}>
    <article>
      <h1>{post.title}</h1>
      <div class="meta">
        {post.date} — {post.author}
      </div>
      <div style="margin-top: 0.5rem; margin-bottom: 1rem">
        {post.tags.map((tag) => (
          <span class="tag">{tag}</span>
        ))}
      </div>
      <div
        class="post-content"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    </article>
  </Layout>
));

// --- About Page ---
export const AboutPage = cc<{}>(() => (
  <Layout title="À propos">
    <h1>À propos</h1>
    <div class="card">
      <h2>SinwanJS</h2>
      <p>
        Un framework web moderne construit pour Bun, avec un moteur de rendu JSX
        natif supportant le streaming SSR progressif.
      </p>
    </div>
    <div class="card">
      <h2>Fonctionnalités</h2>
      <p>• Rendu JSX côté serveur (SSR)</p>
      <p>• Streaming SSR progressif</p>
      <p>• Routeur radix-tree performant</p>
      <p>• Context pooling pour haute performance</p>
      <p>• WebSocket, TCP, UDP intégrés</p>
    </div>
  </Layout>
));

// --- Form Test Page ---
export const FormTestPage = cc<{}>(() => (
  <Layout title="Test Formulaire">
    <h1>Test Formulaire</h1>
    <div class="card">
      <h2>Envoyer des données au serveur</h2>
      <form
        action="/form-submit"
        method="POST"
        id="testForm"
        style="display: flex; flex-direction: column; gap: 1rem;"
      >
        <div>
          <label style="display: block; margin-bottom: 0.5rem; font-weight: bold;">
            Nom:
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            style="width: 100%; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 1rem;"
          />
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.5rem; font-weight: bold;">
            Email:
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            style="width: 100%; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 1rem;"
          />
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.5rem; font-weight: bold;">
            Message:
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows="4"
            style="width: 100%; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 1rem; resize: vertical;"
          />
        </div>
        <button
          type="submit"
          style="background: #2563eb; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-size: 1rem; font-weight: bold; cursor: pointer; width: fit-content;"
        >
          Envoyer
        </button>
      </form>
      <div
        id="result"
        style="margin-top: 1rem; padding: 1rem; border-radius: 4px; display: none;"
      ></div>
    </div>
    <div class="card">
      <h2>Instructions</h2>
      <p>Remplissez le formulaire ci-dessus et cliquez sur "Envoyer".</p>
      <p>
        Les données seront envoyées au serveur via POST en JSON et loggées dans
        la console.
      </p>
    </div>
  </Layout>
));
