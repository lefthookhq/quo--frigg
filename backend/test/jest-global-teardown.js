/**
 * Custom Jest global teardown
 * Since we're using Docker MongoDB, we don't need to stop anything
 */
module.exports = async function () {
    // Docker MongoDB continues running after tests
    // Use `npm run docker:stop` to stop it manually
    console.log('Tests completed. Docker MongoDB still running.');
};
