"""Seeds a Maildir with messages shaped like the ones a real inbox sends.

Every awkward case Skybox will have to read is here on purpose: multipart
alternative, base64 and quoted-printable bodies, a Latin-1 subject and body,
a thread held together by In-Reply-To and References, an attachment, and a
message with no plain-text part at all.

Maildir flags live in the filename: `:2,S` is seen, and no flag is unread.
"""

import email.utils
import io
import os
import time

MAILDIR = os.path.expanduser("~/Mail/mail/INBOX")


def write(name, text, seen=False, charset="utf-8"):
    for part in ("cur", "new", "tmp"):
        os.makedirs(os.path.join(MAILDIR, part), exist_ok=True)
    # Seen mail lives in cur with its flags; unread mail waits in new.
    folder = "cur" if seen else "new"
    filename = "%s.%s.skybox%s" % (int(time.time()), name, ":2,S" if seen else "")
    path = os.path.join(MAILDIR, folder, filename)
    # The bytes a message carries are the bytes its headers claim.
    io.open(path, "w", encoding=charset, newline="\r\n").write(text)
    return path


def headers(subject, sender, to, date, extra=""):
    return (
        "Return-Path: <%s>\n"
        "Delivered-To: %s\n"
        "Message-ID: <%s>\n"
        "Date: %s\n"
        "From: %s\n"
        "To: %s\n"
        "Subject: %s\n"
        "MIME-Version: 1.0\n%s"
    ) % (sender, to, subject.lower().replace(" ", "-") + "@example.net", date, sender, to, subject, extra)


ME = "neo <neo@example.net>"
NOW = time.time()


def when(hours_ago):
    return email.utils.formatdate(NOW - hours_ago * 3600, localtime=True)


# 1. The plainest thing there is.
write(
    "plain",
    headers("Lunch on Thursday?", "Marion <marion@example.org>", ME, when(30),
            "Content-Type: text/plain; charset=utf-8\n\n")
    + "Are you free Thursday? There is a new place by the station that does\n"
      "the sandwiches you like.\n\nM\n",
    seen=True,
)

# 2. Multipart alternative, quoted-printable text and HTML: the common case.
write(
    "alternative",
    headers("The photos from Saturday", "Jun <jun@example.org>", ME, when(6),
            'Content-Type: multipart/alternative; boundary="bound42"\n\n')
    + "--bound42\n"
      "Content-Type: text/plain; charset=utf-8\n"
      "Content-Transfer-Encoding: quoted-printable\n\n"
      "Here are the ones that came out. The light was better than it looked =\n"
      "at the time =E2=80=94 see the third one especially.\n\n"
      "--bound42\n"
      "Content-Type: text/html; charset=utf-8\n"
      "Content-Transfer-Encoding: quoted-printable\n\n"
      "<html><body><p>Here are the ones that came out. The light was better =\n"
      "than it looked at the time.</p><p><i>See the third one especially.</i>=\n"
      "</p></body></html>\n\n"
      "--bound42--\n",
)

# 3. A thread: three messages tied by In-Reply-To and References.
write(
    "thread-1",
    headers("Re: the grid idea", "Ada <ada@example.org>", ME, when(52),
            "Content-Type: text/plain; charset=utf-8\n\n")
    + "I had a look at what you sent. The part I keep coming back to is that\n"
      "everything is in one place rather than filed.\n",
    seen=True,
)
write(
    "thread-2",
    headers("Re: the grid idea", ME, "Ada <ada@example.org>", when(50),
            "In-Reply-To: <re:-the-grid-idea@example.net>\n"
            "References: <re:-the-grid-idea@example.net>\n"
            "Content-Type: text/plain; charset=utf-8\n\n")
    + "That is the whole point of it. Filing is work you do for a machine.\n",
    seen=True,
)
write(
    "thread-3",
    headers("Re: the grid idea", "Ada <ada@example.org>", ME, when(3),
            "In-Reply-To: <re:-the-grid-idea@example.net>\n"
            "References: <re:-the-grid-idea@example.net>\n"
            "Content-Type: text/plain; charset=utf-8\n\n")
    + "Then what happens when there are ten thousand of them? Does the search\n"
      "hold up, or does it become a different problem?\n",
)

# 4. Base64, and a subject that needs RFC 2047 decoding.
write(
    "base64",
    headers("=?utf-8?B?U2FsdXQgZGUgUGFyaXMg4piA?=", "Camille <camille@example.fr>", ME, when(14),
            "Content-Type: text/plain; charset=utf-8\n"
            "Content-Transfer-Encoding: base64\n\n")
    + "Qm9uam91ciEgSWwgZmFpdCBiZWF1IGljaS4gTGUgY2Fmw6kgZXN0IGNoZXIgbWFpcyBi\n"
      "b24uIMOAIGJpZW50w7R0LAoKQ2FtaWxsZQo=\n",
)

# 5. Latin-1, which TextDecoder can read and a naive parser cannot.
write(
    "latin1",
    headers("=?iso-8859-1?Q?Gr=FC=DFe_aus_Wien?=", "Heinz <heinz@example.at>", ME, when(20),
            "Content-Type: text/plain; charset=iso-8859-1\n\n")
    + "Gr\xfc\xdfe aus Wien! Der Kaffee hier ist ausgezeichnet.\n",
    seen=True,
    charset="iso-8859-1",
)

# 6. An attachment beside the text.
write(
    "attachment",
    headers("The invoice you asked for", "Billing <billing@example.com>", ME, when(70),
            'Content-Type: multipart/mixed; boundary="mixed9"\n\n')
    + "--mixed9\n"
      "Content-Type: text/plain; charset=utf-8\n\n"
      "Attached, as promised. Due at the end of the month.\n\n"
      "--mixed9\n"
      'Content-Type: application/pdf; name="invoice.pdf"\n'
      "Content-Transfer-Encoding: base64\n"
      'Content-Disposition: attachment; filename="invoice.pdf"\n\n'
      "JVBERi0xLjQKJSBub3QgcmVhbGx5IGEgcGRmCg==\n\n"
      "--mixed9--\n",
    seen=True,
)

# 7. HTML only, which is most marketing mail and some people's clients.
write(
    "html-only",
    headers("Your weekly digest", "Digest <digest@example.com>", ME, when(9),
            "Content-Type: text/html; charset=utf-8\n\n")
    + "<html><body><h1>This week</h1><p>Three things happened, and we have\n"
      "written about all of them at <a href=\"https://example.com\">length</a>.</p>\n"
      "<p>&mdash; the editors</p></body></html>\n",
)

counts = {
    folder: len(os.listdir(os.path.join(MAILDIR, folder)))
    for folder in ("new", "cur")
    if os.path.isdir(os.path.join(MAILDIR, folder))
}
print("seeded", MAILDIR)
print("unread (new):", counts.get("new", 0), "| read (cur):", counts.get("cur", 0))
