Output docs/demo.gif
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "cd $(mktemp -d) && git init -q -b main . && export HOME=$(mktemp -d) && sh $WHYLINE_DEMO_SETUP && clear"
Enter
Sleep 3s
Show

Type "whyline"
Enter
Sleep 5s
Type "clear"
Enter
Type "whyline --brief"
Enter
Sleep 4s
