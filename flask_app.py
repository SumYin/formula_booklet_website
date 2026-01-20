import os
import re
from dataclasses import dataclass
from pathlib import Path

from flask import Flask, abort, render_template, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
BOOKLETS_FOLDER = BASE_DIR / "booklets"


@dataclass(frozen=True)
class BookletItem:
    filename: str
    name: str
    year: str
    effect: str


_FILENAME_RE = re.compile(r"^(?P<name>.+)_(?P<year>\d{4})\.pdf$", re.IGNORECASE)


_EFFECT_BY_KEYWORD: dict[str, str] = {
    # Allow multiple keywords to map to the same effect.
    "math": "glow-matrix",
    "physics": "vector-field",
    # "chemistry": "..."  # placeholder for future custom effect
}


def _effect_for_booklet(name: str, filename: str) -> str:
    # Decide effects based on either booklet name or filename.
    # Keep it simple + predictable: keyword match on lowercased strings.
    haystack = f"{name} {filename}".lower()
    for keyword, effect in _EFFECT_BY_KEYWORD.items():
        if keyword in haystack:
            return effect
    return ""


def create_app() -> Flask:
    app = Flask(__name__)

    app.config.from_mapping(
        CONTACT_EMAIL=os.environ.get("CONTACT_EMAIL", "suzhang@asbarcelona.com"),
        GITHUB_REPO_URL=os.environ.get(
            "GITHUB_REPO_URL", "https://github.com/sumyin/formula_booklet_website"
        ),
    )

    @app.get("/")
    def index():
        items: list[BookletItem] = []
        if BOOKLETS_FOLDER.exists() and BOOKLETS_FOLDER.is_dir():
            for entry in sorted(os.listdir(BOOKLETS_FOLDER)):
                if not entry.lower().endswith(".pdf"):
                    continue

                match = _FILENAME_RE.match(entry)
                if match:
                    name = match.group("name")
                    year = match.group("year")
                else:
                    name = os.path.splitext(entry)[0]
                    year = ""

                items.append(
                    BookletItem(
                        filename=entry,
                        name=name,
                        year=year,
                        effect=_effect_for_booklet(name=name, filename=entry),
                    )
                )

        return render_template("index.html", items=items, active_page="home")

    @app.get("/contact")
    def contact():
        return render_template(
            "contact.html",
            active_page="contact",
            contact_email=app.config["CONTACT_EMAIL"],
            github_repo_url=app.config["GITHUB_REPO_URL"],
        )

    @app.get("/booklets/<path:filename>")
    def serve_booklet(filename: str):
        # Serve the PDF file
        if not filename.lower().endswith(".pdf"):
            abort(404)
        return send_from_directory(BOOKLETS_FOLDER, filename)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
