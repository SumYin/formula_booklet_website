# Formula Booklet Website (Flask)

This is a small Flask site that lists PDF files in the `booklets/` folder and serves them at `/booklets/<filename>`.

## Folder layout

- `booklets/` — your PDFs (expected format: `name_year.pdf`)
- `templates/` — HTML templates (Bootswatch **Brite** theme)
- `app.py` — Flask app

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open:
- `http://127.0.0.1:5000/` (listing)
- `http://127.0.0.1:5000/booklets/MathAA_2021.pdf` (example PDF)

## PythonAnywhere notes

- Point your WSGI file at `flask_app` inside `flask_app.py` (this repo exposes `app = create_app()`).
- Make sure the `booklets/` folder exists in the same directory as `app.py` on PythonAnywhere.

The serving route is:

```python
@app.get('/booklets/<path:filename>')
def serve_booklet(filename):
    return send_from_directory(BOOKLETS_FOLDER, filename)
```
