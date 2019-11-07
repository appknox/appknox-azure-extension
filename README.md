# appknox-azure-extension
Appknox azure pipeline extension for auto security testing

## Development
- install node
- npm install -g tfx-cli
- cd buildAndReleaseTask
- npm install

Edit task.json to update version

Edit index.ts to update business logic/params

Finally, run

```
  tsc
```

## Build
```
  cd buildAndReleaseTask && npm install && tsc;cd .. && tfx extension create --rev-version --manifest-globs vss-extension.json
```

Then upload extension (vsix) to https://marketplace.visualstudio.com/manage/publishers/appknox

### Installation

See [Overview documentation](overview.md)
