import { Sinwan } from "../index";
import {
  AboutPage,
  BlogListPage,
  BlogPostPage,
  HomePage,
  FormTestPage,
} from "./example";

// =============================================================================
// SERVER
// =============================================================================

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
      "<p>SinwanJS utilise un système de composants JSX avec trois niveaux:</p><p><strong>cc</strong> — composants réutilisables (header, card, footer...)</p><p><strong>cc</strong> — structure HTML commune (html, head, body)</p><p><strong>cc</strong> — pages typées recevant des données du serveur</p>",
    date: "2024-01-05",
    author: "Mohammed",
    tags: ["JSX", "Composants", "Architecture"],
  },
];

// Create the app
const app = new Sinwan({
  error: {
    onError(error) {
      console.log("hada error", error);
    },
    responseType: "html",
  },
});

// Route: Blog list (uses streaming SSR for progressive rendering)
app.get("/blog", async (c) => {
  await c.render("blog-list", BlogListPage, { posts: POSTS });
});

// Route: Home
app.get("/", async (c) => {
  const data = c.redirectData<{ message: string }>();
  console.log(data);

  await c.render("home", HomePage, {
    message:
      data?.message ||
      "Ce site est un exemple de Server-Side Rendering avec SinwanJS. Chaque page est rendue en HTML côté serveur grâce au moteur JSX intégré.",
  });
});

// Route: Individual blog post
app.get("/blog/:slug", async (c) => {
  const slug = c.params.slug;
  const post = POSTS.find((p) => p.slug === slug);

  if (!post) {
    c.html("<h1>404 — Article non trouvé</h1>", 404);
    return;
  }

  await c.render("blog-post", BlogPostPage, { post });
});

// Route: About
app.get("/about", async (c) => {
  c.streamRender("about", AboutPage, {});
});

// Route: JSON API (bonus)
app.get("/api/posts", (c) => {
  c.json(POSTS);
});

// Route: Form test page
app.get("/form-test", async (c) => {
  await c.render("form-test", FormTestPage, {});
});

// Route: Form submission handler
app.post("/form-submit", async (c) => {
  const body = await c.parseBody<{
    name: string;
    email: string;
    message: string;
  }>();
  console.log("=== Form Data Received ===");
  console.log("Name:", body.name);
  console.log("Email:", body.email);
  console.log("Message:", body.message);
  console.log("Full data:", body);
  console.log("==========================");
  c.redirectWith("/", { message: "hello from the post method" });
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
  console.log("    GET /form-test → Page de test formulaire");
  console.log(
    "    POST /form-submit → Réception données formulaire (log console)",
  );
  console.log("    GET /api/posts → API JSON");
  console.log("");
});
