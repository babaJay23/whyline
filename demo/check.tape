Output docs/demo-check.gif
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
Type "# a policy file says what a change must not contain"
Enter
Sleep 2s
Type "cat .whyline.json"
Enter
Sleep 2s
Enter
Type "whyline check --policy .whyline.json; echo exit=$?"
Enter
Sleep 5s
Type "clear"
Enter
Type "# --format md is what a CI job posts on the pull request"
Enter
Sleep 2s
Type "whyline check --policy .whyline.json --format md"
Enter
Sleep 6s
