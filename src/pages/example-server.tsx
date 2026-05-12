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

import {
  Sinwan,
  registerPage,
  createLayout,
  createComponent,
  createPage,
} from "../index";

// =============================================================================
// LAYOUT
// =============================================================================

interface LayoutProps {
  title: string;
  description?: string;
}

const Layout = createLayout<LayoutProps>(({ title, description, children }) => (
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

const ArticleCard = createComponent<ArticleCardProps>(
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

const HomePage = createPage<HomeData>(({ message }) => (
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

const BlogListPage = createPage<BlogListData>(({ posts }) => (
  <Layout title="Articles" description="Tous les articles du blog">
    <h1>Articles</h1>
    <p style="color: #555; margin-bottom: 1.5rem">
      {posts.length} article{posts.length > 1 ? "s" : ""} disponible
      {posts.length > 1 ? "s" : ""}
    </p>
    {posts.map((post) => (
      <ArticleCard
        title={post.title}
        excerpt={post.excerpt}
        slug={post.slug}
        date={post.date}
        author={post.author}
        tags={post.tags}
      />
    ))}
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

const BlogPostPage = createPage<BlogPostData>(({ post }) => (
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
const AboutPage = createPage<{}>(() => (
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

// =============================================================================
// SERVER
// =============================================================================

// Register all pages
registerPage("home", HomePage);
registerPage("blog-list", BlogListPage);
registerPage("blog-post", BlogPostPage);
registerPage("about", AboutPage);

// Simulated blog data
const POSTS = [
  {
    id: 1,
    title: "Introduction à SinwanJS",
    slug: "introduction-sinwanjs",
    excerpt:
      "Découvrez comment construire des applications web performantes avec SinwanJS et Bun.",
    content:
      "<p>SinwanJS est un framework web moderne conçu pour tirer parti de la vitesse de Bun.</p><p>Il offre un système de rendu JSX natif qui compile en constructeurs de chaînes optimisés, avec support du streaming progressif.</p><p>Grâce au context pooling et au routeur radix-tree, les performances sont au rendez-vous même sous forte charge.</p>",
    date: "2024-01-15",
    author: "Mohammed",
    tags: ["JavaScript", "Framework", "Bun"],
  },
  {
    id: 2,
    title: "Streaming SSR avec Bun",
    slug: "streaming-ssr-bun",
    excerpt:
      "Comment implémenter le streaming SSR progressif pour améliorer le Time-to-First-Byte.",
    content:
      "<p>Le streaming SSR permet d'envoyer le HTML progressivement au navigateur sans attendre que toute la page soit générée.</p><p>Avec SinwanJS, il suffit d'utiliser <code>c.streamRender()</code> au lieu de <code>c.render()</code> pour activer le streaming.</p><p>Le résultat: un TTFB bien meilleur et une meilleure expérience utilisateur.</p>",
    date: "2024-01-10",
    author: "Mohammed",
    tags: ["SSR", "Streaming", "Performance"],
  },
  {
    id: 3,
    title: "Architecture des composants JSX",
    slug: "architecture-composants-jsx",
    excerpt:
      "Organisez votre UI avec des composants réutilisables, layouts et pages typés.",
    content:
      "<p>SinwanJS utilise un système de composants JSX avec trois niveaux:</p><p><strong>createComponent</strong> — composants réutilisables (header, card, footer...)</p><p><strong>createLayout</strong> — structure HTML commune (html, head, body)</p><p><strong>createPage</strong> — pages typées recevant des données du serveur</p>",
    date: "2024-01-05",
    author: "Mohammed",
    tags: ["JSX", "Composants", "Architecture"],
  },
];

// Create the app
const app = new Sinwan();

// Route: Home
app.get("/", (c) => {
  return c.render("home", {
    message:
      "Ce site est un exemple de Server-Side Rendering avec SinwanJS. Chaque page est rendue en HTML côté serveur grâce au moteur JSX intégré.",
  });
});

// Route: Blog list (uses streaming SSR for progressive rendering)
app.get("/blog", (c) => {
  c.streamRender("blog-list", { posts: POSTS });
});

// Route: Individual blog post
app.get("/blog/:slug", (c) => {
  const slug = c.params.slug;
  const post = POSTS.find((p) => p.slug === slug);

  if (!post) {
    c.html("<h1>404 — Article non trouvé</h1>", 404);
    return;
  }

  return c.render("blog-post", { post });
});

// Route: About
app.get("/about", (c) => {
  return c.render("about", {});
});

// Route: JSON API (bonus)
app.get("/api/posts", (c) => {
  c.json(POSTS);
});

// Start the server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 SinwanJS SSR Server running at http://localhost:${PORT}\n`);
  console.log("  Routes:");
  console.log("    GET /          → Page d'accueil (render)");
  console.log("    GET /blog      → Liste des articles (streamRender)");
  console.log("    GET /blog/:slug → Article individuel (render)");
  console.log("    GET /about     → Page à propos (render)");
  console.log("    GET /api/posts → API JSON");
  console.log("");
});
