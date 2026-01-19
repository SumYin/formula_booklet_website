import os
import re
from dataclasses import dataclass
from pathlib import Path

from flask import Flask, abort, render_template, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
BOOKLETS_FOLDER = BASE_DIR / "booklet"


@dataclass(frozen=True)
class BookletItem:
    filename: str
    name: str
    year: str


_FILENAME_RE = re.compile(r"^(?P<name>.+)_(?P<year>\d{4})\.pdf$", re.IGNORECASE)


def create_app() -> Flask:
    app = Flask(__name__)

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

                items.append(BookletItem(filename=entry, name=name, year=year))

        return render_template("index.html", items=items)

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
