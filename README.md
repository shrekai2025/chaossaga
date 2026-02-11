# ChaosSaga

ChaosSaga is an AI-powered Role-Playing Game (RPG) built with Next.js. It features dynamic storytelling, LLM-driven NPC interactions, and an evolving world state.

## Features

- **AI-Driven Storytelling**: Utilizing advanced LLM adapters (OpenAI, Anthropic, Google, etc.) to generate dynamic narratives and dialogue.
- **Dynamic World**: An evolving game world with interactive nodes, quests, and events.
- **NPC Interaction**: converse with NPCs who have distinct personalities and memories.
- **Battle System**: Turn-based combat system with AI-narrated descriptions.
- **Modern Tech Stack**: Built with Next.js 15, Prisma, PostgreSQL, and Tailwind CSS.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database

### Installation

1.  Clone the repository:

    ```bash
    git clone https://github.com/yourusername/chaossaga.git
    cd chaossaga
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Set up environment variables:
    Create a `.env` file in the root directory based on `.env.example`. You will need to provide:
    - `DATABASE_URL`: Your PostgreSQL connection string.
    - `TUZI_API_KEY` / `OPENROUTER_API_KEY`: API keys for your chosen LLM provider.

4.  Initialize the database:

    ```bash
    npm run db:generate
    npm run db:push
    npm run db:seed
    ```

5.  Run the development server:

    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Configuration

The game configuration prioritizes settings in the following order:

1.  **Database (`GameConfig` table)**: Settings changed via the in-game UI.
2.  **Environment Variables**: Defined in `.env`.
3.  **Default Values**: Hardcoded fallbacks in `src/lib/ai/config.ts`.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/)
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **AI Integration**: Custom adapters for various LLM providers.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
