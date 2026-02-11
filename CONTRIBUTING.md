# Contributing to ChaosSaga

Thank you for your interest in contributing to ChaosSaga! We welcome contributions from the community to help make this AI-powered RPG even better.

## How to Contribute

### Reporting Bugs

If you find a bug, please create a GitHub issue with the following details:

- A clear, descriptive title.
- Steps to reproduce the bug.
- Expected behavior vs. actual behavior.
- Screenshots or logs if applicable.

### Suggesting Enhancements

We love new ideas! If you have a suggestion for a feature or improvement, please open an issue and tag it as an "enhancement".

### Pull Requests

1. Fork the repository.
2. Create a new branch for your feature or bug fix: `git checkout -b feature/amazing-feature`.
3. Make your changes and commit them with clear messages.
4. Push to your branch: `git push origin feature/amazing-feature`.
5. Open a Pull Request against the `main` branch.

## Development Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/yourusername/chaossaga.git
    cd chaossaga
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Set up environment variables:**
    Copy `.env.example` to `.env` and fill in the required API keys (e.g., Database URL, LLM Provider keys).

4.  **Run the development server:**
    ```bash
    npm run dev
    ```

## Coding Standards

- We use ESLint and Prettier to maintain code quality. Please run `npm run lint` before submitting your PR.
- Follow the existing project structure and naming conventions.
- Write comments for complex logic.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
