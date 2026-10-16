Output docs/demo-attach.gif
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 680
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Hide
Type "cd $(mktemp -d) && git init -q -b main . && export HOME=$(mktemp -d) && sh $WHYLINE_DEMO_SETUP && clear"
Enter
Sleep 3s
Show
Type "# transcripts expire; attach keeps the record with the commit, in git notes"
Enter
Sleep 2s
Type "git add -A && git commit -qm 'add TRANSCRIPTION (#31)'"
Enter
Sleep 1s
Type "whyline attach"
Enter
Sleep 2s
Type "# the note is plain JSON: the same report, plus a hash"
Enter
Sleep 2s
Type "git notes --ref whyline show HEAD | head -14"
Enter
Sleep 5s
Type "clear"
Enter
Type "# anyone with the notes fetched can verify it, with no transcript at all"
Enter
Sleep 2s
Type "whyline verify"
Enter
Sleep 5s
