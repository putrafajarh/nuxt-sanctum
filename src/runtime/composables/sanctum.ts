import {
	useCookie,
	useRequestHeaders,
	useRouter,
	useRuntimeConfig,
	useState,
} from "#imports";
import { ofetch } from "ofetch";
import { parse, splitCookiesString } from "set-cookie-parser-es";

export const useSanctum = <TUser extends Record<string, unknown>>() => {
	const config = useRuntimeConfig().public.sanctum;
	const csrfToken = useState<string | null | undefined>("sanctum.csrfToken");
	const authenticated = useState<boolean | null>(
		"sanctum.authenticated",
		() => null,
	);
	const user = useState<TUser | null>("sanctum.user", () => null);

	const sanctumFetch = ofetch.create({
		baseURL: config.url,
		credentials: "include",
		redirect: "manual",
		mode: "cors",
		headers: {
			Origin: useRequestHeaders(["host"]).host,
			Accept: "application/json",
		} as HeadersInit,
		onResponse: (response) => {
			if (process.server) {
				const split = splitCookiesString(
					response.response.headers.get("set-cookie") ?? "",
				);
				const cookies = parse(split);
				csrfToken.value = cookies.find(
					(cookie) => cookie.name === "XSRF-TOKEN",
				)?.value;
			}

			if (process.client) {
				csrfToken.value = useCookie("XSRF-TOKEN").value;
			}
		},
	});

	/**
	 * Refreshes the CSRF token.
	 *
	 * This method will call the CSRF endpoint and update the CSRF token.
	 *
	 * @returns The new CSRF token.
	 */
	const refreshCsrfToken = async (): Promise<string | null | undefined> => {
		await sanctumFetch(config.csrf.endpoint);
		csrfToken.value = useCookie("XSRF-TOKEN").value;
		return csrfToken.value;
	};

	/**
	 * Checks whether the user is authenticated.
	 *
	 * @returns Whether the user is authenticated.
	 */
	const check = async (): Promise<boolean> => {
		try {
			const response = await sanctumFetch(config.check.endpoint, {
				headers: {
					...useRequestHeaders(["cookie"]),
					"X-XSRF-TOKEN": csrfToken.value,
				} as HeadersInit,
			});
			user.value = response;
			authenticated.value = true;
		} catch (error) {
			console.log(error);
			authenticated.value = false;
		}
		return authenticated.value;
	};

	/**
	 * Signs the user in.
	 *
	 * This method will attempt to sign the user in by sending the provided
	 * credentials to the API's login endpoint. It will also update the user's
	 * authentication state in the store.
	 *
	 * If a redirection URL has been provided, the user will be redirected to
	 * that URL after being signed in. If no redirection URL has been provided,
	 * you are responsible for handling it yourself.
	 *
	 * @param data The credentials to use to sign the user in.
	 * @returns Whether the user was successfully signed in.
	 */
	const login = async (
		data: Record<string, string>,
		redirectTo?: string,
	): Promise<boolean> => {
		// Refresh the CSRF token before attempting to sign in.
		await refreshCsrfToken();

		try {
			// Attempt to authenticate the user.
			await sanctumFetch(config.login.endpoint, {
				method: "POST",
				body: JSON.stringify(data),
				headers: {
					"X-XSRF-TOKEN": csrfToken.value,
				} as HeadersInit,
			});

			// Check if the user is authenticated.
			await check();

			// Redirect if a redirect is provided.
			if (redirectTo || config.login.redirectsTo) {
				useRouter().push(redirectTo ?? config.login.redirectsTo);
			}

			return true;
		} catch {
			authenticated.value = false;
			return false;
		}
	};

	/**
	 * Signs in the user out.
	 *
	 * This method will attempt to sign the user out by sending a request to
	 * the API's logout endpoint. It will also update the user's authentication
	 * state in the store.
	 *
	 * If a redirection URL has been provided, the user will be redirected to
	 * that URL after being signed out. If no redirection URL is provided to
	 * the function, the default redirection URL will be used, and if no
	 * default redirection URL is provided, no redirection will occur.
	 *
	 * @returns Whether the user was successfully signed out.
	 */
	const logout = async (redirectTo?: string): Promise<boolean> => {
		try {
			// Attempt to logout the user.
			await sanctumFetch(config.logout.endpoint, {
				method: "POST",
				headers: {
					"X-XSRF-TOKEN": csrfToken.value,
				} as HeadersInit,
			});

			// Set the user as unauthenticated.
			authenticated.value = false;

			// Redirect if a redirect is provided.
			if (redirectTo ?? config.logout.redirectsTo) {
				useRouter().push(config.logout.redirectsTo);
			}

			return true;
		} catch {
			return false;
		}
	};

	return {
		check,
		user,
		refreshUser: check,
		login,
		logout,
		refreshCsrfToken,
		csrfToken,
		authenticated,
	};
};
