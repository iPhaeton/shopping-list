Probably a bug:
When the app is loaded, the following queries run:
- fetch the lists
- fetch items for every list from the device cache
The issue is that each query is run twice.