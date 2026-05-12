/**
 * Exemple de page réelle SinwanJS - Blog avec JSX
 *
 * Ce fichier utilise la syntaxe JSX native avec les factories SinwanJS.
 *
 * Demonstrates:
 * - createLayout: mise en page HTML complète
 * - createComponent: composants réutilisables
 * - createPage: page avec données typées
 * - Intégration avec le router
 */

import {
  createLayout,
  createComponent,
  createPage,
  registerPage,
  renderPage,
} from "../view";

// =============================================================================
// LAYOUT - Structure HTML complète
// =============================================================================

interface LayoutProps {
  title: string;
  description?: string;
  lang?: string;
}

const Layout = createLayout<LayoutProps>(
  ({ title, description, lang = "fr", children }) => (
    <html class={"h-full"} lang={lang}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        {children}
        <script src="/app.js"></script>
      </body>
    </html>
  ),
);

// =============================================================================
// COMPOSANTS RÉUTILISABLES
// =============================================================================

// Header avec navigation
interface HeaderProps {
  siteName: string;
  navItems: { label: string; href: string }[];
}

const Header = createComponent<HeaderProps>(({ siteName, navItems }) => (
  <header class="site-header">
    <div class="container">
      <a href="/" class="logo">
        {siteName}
      </a>
      <nav class="main-nav">
        <ul>
          {navItems.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  </header>
));

// Carte d'article
interface ArticleCardProps {
  title: string;
  excerpt: string;
  date: string;
  author: string;
  slug: string;
  tags?: string[];
}

const ArticleCard = createComponent<ArticleCardProps>(
  ({ title, excerpt, date, author, slug, tags = [] }) => (
    <article class="article-card">
      <div class="card-header">
        <time class="date">{date}</time>
        <span class="author">par {author}</span>
      </div>
      <h2 class="card-title">
        <a href={`/blog/${slug}`}>{title}</a>
      </h2>
      <p class="card-excerpt">{excerpt}</p>
      {tags.length > 0 && (
        <div class="tags">
          {tags.map((tag) => (
            <span key={tag} class="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  ),
);

// Pied de page
interface FooterProps {
  copyright: string;
  links?: { label: string; href: string }[];
}

const Footer = createComponent<FooterProps>(({ copyright, links = [] }) => (
  <footer class="site-footer">
    <div class="container">
      {links.length > 0 && (
        <nav class="footer-nav">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      )}
      <p class="copyright">{copyright}</p>
    </div>
  </footer>
));

// =============================================================================
// PAGES
// =============================================================================

// Données pour la page d'accueil du blog
interface BlogHomeData {
  siteName: string;
  pageTitle: string;
  description: string;
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

// Page d'accueil du blog
const BlogHomePage = createPage<BlogHomeData>(
  ({ siteName, pageTitle, description, posts }) => (
    <Layout title={pageTitle} description={description}>
      <Header
        siteName={siteName}
        navItems={[
          { label: "Accueil", href: "/" },
          { label: "Articles", href: "/blog" },
          { label: "À propos", href: "/about" },
          { label: "Contact", href: "/contact" },
        ]}
      />

      <main class="main-content">
        <section class="hero-section">
          <div class="container">
            <h1 class="page-title">{pageTitle}</h1>
            <p class="page-description">{description}</p>
          </div>
        </section>

        <section class="articles-section">
          <div class="container">
            <div class="articles-grid">
              {posts.map((post) => (
                <ArticleCard
                  key={post.id}
                  title={post.title}
                  excerpt={post.excerpt}
                  slug={post.slug}
                  date={post.date}
                  author={post.author}
                  tags={post.tags}
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer
        copyright={`© ${new Date().getFullYear()} ${siteName}. Tous droits réservés.`}
        links={[
          { label: "Mentions légales", href: "/legal" },
          { label: "Politique de confidentialité", href: "/privacy" },
        ]}
      />
    </Layout>
  ),
);

// Données pour une page article individuelle
interface BlogPostData {
  siteName: string;
  post: {
    title: string;
    content: string;
    date: string;
    author: string;
    authorBio?: string;
    tags: string[];
    readingTime: string;
  };
  relatedPosts: {
    id: number;
    title: string;
    slug: string;
  }[];
}

// Page article individuelle
const BlogPostPage = createPage<BlogPostData>(
  ({ siteName, post, relatedPosts }) => (
    <Layout title={post.title}>
      <Header
        siteName={siteName}
        navItems={[
          { label: "Accueil", href: "/" },
          { label: "Articles", href: "/blog" },
          { label: "À propos", href: "/about" },
          { label: "Contact", href: "/contact" },
        ]}
      />

      <main class="main-content">
        <article class="blog-post">
          <div class="container">
            <header class="post-header">
              <h1 class="post-title">{post.title}</h1>
              <div class="post-meta">
                <time>{post.date}</time>
                <span class="author">{post.author}</span>
                <span class="reading-time">{post.readingTime}</span>
              </div>
              <div class="tags">
                {post.tags.map((tag) => (
                  <span key={tag} class="tag">
                    {tag}
                  </span>
                ))}
              </div>
            </header>

            <div
              class="post-content"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {post.authorBio && (
              <footer class="post-footer">
                <div class="author-bio">
                  <h3>À propos de l'auteur</h3>
                  <p>{post.authorBio}</p>
                </div>
              </footer>
            )}
          </div>
        </article>

        {relatedPosts.length > 0 && (
          <aside class="related-posts">
            <div class="container">
              <h2>Articles similaires</h2>
              <ul>
                {relatedPosts.map((related) => (
                  <li key={related.id}>
                    <a href={`/blog/${related.slug}`}>{related.title}</a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </main>

      <Footer
        copyright={`© ${new Date().getFullYear()} ${siteName}. Tous droits réservés.`}
      />
    </Layout>
  ),
);

// =============================================================================
// UTILISATION AVEC LE ROUTER
// =============================================================================

// Enregistrer les pages
registerPage("blog-home", BlogHomePage);
registerPage("blog-post", BlogPostPage);

// Exemple d'utilisation avec Sinwan (à placer dans votre fichier serveur):
/*
import { Sinwan } from "../index";

const app = new Sinwan();

// Route: Page d'accueil du blog
app.get("/blog", (c) => {
  return c.render("blog-home", {
    siteName: "Mon Blog",
    pageTitle: "Articles récents",
    description: "Découvrez nos derniers articles sur la technologie et le développement web.",
    posts: [
      {
        id: 1,
        title: "Introduction à SinwanJS",
        excerpt: "Découvrez comment construire des applications web performantes avec SinwanJS...",
        slug: "introduction-sinwanjs",
        date: "2024-01-15",
        author: "Jean Dupont",
        tags: ["JavaScript", "Framework", "Tutorial"],
      },
      {
        id: 2,
        title: "Les avantages de Bun",
        excerpt: "Pourquoi Bun change la donne pour le runtime JavaScript...",
        slug: "avantages-bun",
        date: "2024-01-10",
        author: "Marie Martin",
        tags: ["Bun", "Runtime", "Performance"],
      },
    ],
  });
});

// Route: Page article individuel
app.get("/blog/:slug", (c) => {
  const slug = c.params.slug;
  
  return c.render("blog-post", {
    siteName: "Mon Blog",
    post: {
      title: "Introduction à SinwanJS",
      content: "<p>SinwanJS est un framework moderne...</p>",
      date: "2024-01-15",
      author: "Jean Dupont",
      authorBio: "Développeur web passionné et créateur de SinwanJS.",
      tags: ["JavaScript", "Framework", "Tutorial"],
      readingTime: "5 min",
    },
    relatedPosts: [
      { id: 2, title: "Les avantages de Bun", slug: "avantages-bun" },
    ],
  });
});

app.listen({ port: 3000 });
console.log("🚀 Serveur démarré sur http://localhost:3000");
*/

// =============================================================================
// TEST RAPIDE (sans serveur)
// =============================================================================

async function testRender() {
  console.log("=== Test de rendu des pages ===\n");

  // Test BlogHomePage
  console.log("1. Rendu BlogHomePage");
  const homeHtml = await renderPage("blog-home", {
    siteName: "Tech Blog",
    pageTitle: "Articles récents",
    description: "Les derniers articles tech.",
    posts: [
      {
        id: 1,
        title: "Introduction à SinwanJS",
        excerpt: "Découvrez ce framework moderne pour Bun...",
        slug: "intro-sinwanjs",
        date: "2024-01-15",
        author: "Jean Dupont",
        tags: ["JavaScript", "Bun"],
      },
      {
        id: 2,
        title: "Streaming SSR avec Bun",
        excerpt: "Comment implémenter le streaming côté serveur...",
        slug: "streaming-ssr",
        date: "2024-01-10",
        author: "Marie Martin",
        tags: ["SSR", "Performance"],
      },
    ],
  });

  console.log("HTML généré (premiers 1000 caractères):");
  console.log(homeHtml.slice(0, 1000) + "...\n");
  console.log(`Taille totale: ${homeHtml.length} caractères\n`);

  // Test BlogPostPage
  console.log("2. Rendu BlogPostPage");
  const postHtml = await renderPage("blog-post", {
    siteName: "Tech Blog",
    post: {
      title: "Introduction à SinwanJS",
      content:
        "<p>SinwanJS est un framework <strong>moderne</strong> construit pour Bun.</p>",
      date: "2024-01-15",
      author: "Jean Dupont",
      authorBio: "Développeur web et créateur de SinwanJS.",
      tags: ["JavaScript", "Framework"],
      readingTime: "3 min",
    },
    relatedPosts: [{ id: 2, title: "Streaming SSR", slug: "streaming-ssr" }],
  });

  console.log("HTML généré (premiers 1000 caractères):");
  console.log(postHtml.slice(0, 1000) + "...\n");
  console.log(`Taille totale: ${postHtml.length} caractères\n`);

  console.log("=== Tests réussis! ===");
}

// Exécuter le test si ce fichier est lancé directement
if (import.meta.main) {
  testRender().catch(console.error);
}

export { Layout, Header, Footer, ArticleCard, BlogHomePage, BlogPostPage };
